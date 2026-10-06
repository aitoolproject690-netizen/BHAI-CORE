import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const PATH = "/v1/mobile-node";
const AUTH_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 65000;
const HEARTBEAT_INTERVAL_MS = 10000;
const MAX_WS_PAYLOAD = 256 * 1024;
const MAX_BODY = 192 * 1024;
const MAX_PATH = 2048;
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const ALLOWED_REQUEST_PREFIX = "/v1/";

let active = null;
let activeConnectedAt = 0;
let activeLastSeenAt = 0;
let sequence = 0;
const pending = new Map();

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function tokens() {
  return [
    process.env.BHAI_MOBILE_NODE_TOKEN,
    process.env.BHAI_ENGINE_API_KEY
  ]
    .map(value => String(value || ""))
    .filter(Boolean);
}

function authenticatedToken(value) {
  return tokens().some(expected => safeEqual(value, expected));
}

function reject(socket, status = 404) {
  socket.write("HTTP/1.1 " + status + " Not Found\r\nConnection: close\r\n\r\n");
  socket.destroy();
}

function validRequestPath(path) {
  return typeof path === "string" &&
    path.length > 0 &&
    path.length <= MAX_PATH &&
    path.startsWith(ALLOWED_REQUEST_PREFIX);
}

function validHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return false;
  return Object.keys(headers).length <= 64 &&
    Object.entries(headers).every(([key, value]) =>
      typeof key === "string" &&
      key.length > 0 &&
      key.length <= 128 &&
      /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) &&
      (typeof value === "string" || Array.isArray(value)) &&
      String(value).length <= 8192
    );
}

export function attachMobileNode(server) {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_WS_PAYLOAD
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));
    if (url.pathname !== PATH) return reject(socket);

    wss.handleUpgrade(req, socket, head, ws => {
      let authenticated = false;
      let heartbeatTimer = null;
      const timer = setTimeout(() => {
        if (!authenticated) {
          console.warn("BHAI mobile node auth timeout");
          ws.close(1008, "authentication required");
        }
      }, AUTH_TIMEOUT_MS);

      const startHeartbeat = () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          try { ws.ping(); } catch {}
        }, HEARTBEAT_INTERVAL_MS);
      };

      ws.on("pong", () => {
        activeLastSeenAt = Date.now();
      });

      ws.on("error", error => {
        console.error("BHAI mobile node websocket:", error?.message || error);
      });

      ws.on("message", raw => {
        let message;
        try {
          message = JSON.parse(String(raw));
        } catch {
          console.warn("BHAI mobile node invalid json");
          return ws.close(1003, "invalid json");
        }

        if (!message || typeof message !== "object" || Array.isArray(message)) {
          return ws.close(1003, "invalid message");
        }

        if (!authenticated) {
          if (message?.type !== "auth" ||
              typeof message.token !== "string" ||
              !authenticatedToken(message.token)) {
            console.warn("BHAI mobile node auth rejected");
            return ws.close(1008, "authentication failed");
          }

          authenticated = true;
          clearTimeout(timer);
          if (active && active !== ws) {
            active.close(1012, "replaced by newer node");
          }
          active = ws;
          activeConnectedAt = Date.now();
          activeLastSeenAt = activeConnectedAt;
          startHeartbeat();
          ws.send(JSON.stringify({ type: "auth_ok" }));
          return;
        }

        activeLastSeenAt = Date.now();

        if (message?.type === "heartbeat") {
          try { ws.send(JSON.stringify({ type: "heartbeat_ack" })); } catch {}
          return;
        }

        if (message?.type !== "response" || typeof message.id !== "string" || !message.id) return;
        const waiter = pending.get(message.id);
        if (!waiter) return;

        pending.delete(message.id);
        clearTimeout(waiter.timer);
        const status = Number(message.status) || 502;
        const body = String(message.body || "");
        waiter.resolve({
          ok: status >= 200 && status < 300,
          status,
          text: async () => body
        });
      });

      ws.on("close", (code, reason) => {
        console.log("BHAI mobile node closed:", Number(code), String(reason || ""));
        clearTimeout(timer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);

        if (active === ws) {
          active = null;
          activeConnectedAt = 0;
          activeLastSeenAt = 0;
          for (const [id, waiter] of pending) {
            clearTimeout(waiter.timer);
            waiter.reject(Object.assign(new Error("Mobile node disconnected"), { status: 503 }));
            pending.delete(id);
          }
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
    configured: tokens().length > 0,
    connected: Boolean(active && active.readyState === WebSocket.OPEN),
    pending: pending.size,
    connectedAt: activeConnectedAt || null,
    lastSeenAt: activeLastSeenAt || null
  };
}

export function requestMobileNode({ path, method = "GET", headers = {}, body = null } = {}) {
  if (!active || active.readyState !== WebSocket.OPEN) {
    return Promise.reject(Object.assign(new Error("BHAI mobile node is not connected"), { status: 503 }));
  }

  const normalizedMethod = String(method || "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(normalizedMethod) || !validRequestPath(path) || !validHeaders(headers)) {
    return Promise.reject(Object.assign(new Error("Invalid mobile node request"), { status: 400 }));
  }

  if (body !== null && String(body).length > MAX_BODY) {
    return Promise.reject(Object.assign(new Error("Mobile node request body too large"), { status: 413 }));
  }

  const id = "mn-" + Date.now().toString(36) + "-" + (++sequence).toString(36);
  return new Promise((resolve, rejectPromise) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectPromise(Object.assign(new Error("BHAI mobile node request timed out"), { status: 504 }));
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, { resolve, reject: rejectPromise, timer });

    try {
      active.send(JSON.stringify({
        type: "request",
        id,
        method: normalizedMethod,
        path,
        headers,
        body
      }));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      rejectPromise(error);
    }
  });
}
