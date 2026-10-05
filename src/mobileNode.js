import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const PATH = "/v1/mobile-node";
const AUTH_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 65000;
const HEARTBEAT_INTERVAL_MS = 10000;

let active = null;
let sequence = 0;
const pending = new Map();

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function token() {
  return String(process.env.BHAI_MOBILE_NODE_TOKEN || process.env.BHAI_ENGINE_API_KEY || "");
}

function reject(socket, status = 404) {
  socket.write(`HTTP/1.1 ${status} Not Found\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function attachMobileNode(server) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));
    if (url.pathname !== PATH) return reject(socket);

    wss.handleUpgrade(req, socket, head, ws => {
      let authenticated = false;
      let heartbeatTimer = null;
      const timer = setTimeout(() => {
        if (!authenticated) ws.close(1008, "authentication required");
      }, AUTH_TIMEOUT_MS);

      const startHeartbeat = () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          try { ws.ping(); } catch {}
        }, HEARTBEAT_INTERVAL_MS);
      };

      ws.on("error", error => {
        console.error("BHAI mobile node websocket:", error?.message || error);
      });

      ws.on("message", raw => {
        let message;
        try { message = JSON.parse(String(raw)); } catch { return ws.close(1003, "invalid json"); }

        if (!authenticated) {
          if (message?.type !== "auth" || !safeEqual(String(message.token || ""), token())) {
            return ws.close(1008, "authentication failed");
          }
          authenticated = true;
          clearTimeout(timer);
          if (active && active !== ws) active.close(1012, "replaced by newer node");
          active = ws;
          startHeartbeat();
          ws.send(JSON.stringify({ type: "auth_ok" }));
          return;
        }

        if (message?.type === "heartbeat") {
          try { ws.send(JSON.stringify({ type: "heartbeat_ack" })); } catch {}
          return;
        }

        if (message?.type !== "response" || !message.id) return;
        const waiter = pending.get(String(message.id));
        if (!waiter) return;
        pending.delete(String(message.id));
        clearTimeout(waiter.timer);
        waiter.resolve({
          ok: Number(message.status) >= 200 && Number(message.status) < 300,
          status: Number(message.status) || 502,
          text: async () => String(message.body || "")
        });
      });

      ws.on("close", () => {
        clearTimeout(timer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (active === ws) active = null;
        for (const [id, waiter] of pending) {
          clearTimeout(waiter.timer);
          waiter.reject(Object.assign(new Error("Mobile node disconnected"), { status: 503 }));
          pending.delete(id);
        }
      });
    });
  });

  return {
    connected: () => Boolean(active && active.readyState === WebSocket.OPEN),
    request: requestMobileNode
  };
}

export function mobileNodeInfo() {
  return {
    configured: Boolean(token()),
    connected: Boolean(active && active.readyState === WebSocket.OPEN),
    pending: pending.size
  };
}

export function requestMobileNode({ path, method = "GET", headers = {}, body = null } = {}) {
  if (!active || active.readyState !== WebSocket.OPEN) {
    return Promise.reject(Object.assign(new Error("BHAI mobile node is not connected"), { status: 503 }));
  }

  const id = "mn-" + Date.now().toString(36) + "-" + (++sequence).toString(36);
  return new Promise((resolve, rejectPromise) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectPromise(Object.assign(new Error("BHAI mobile node request timed out"), { status: 504 }));
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, { resolve, reject: rejectPromise, timer });
    try {
      active.send(JSON.stringify({ type: "request", id, method, path, headers, body }));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      rejectPromise(error);
    }
  });
}
