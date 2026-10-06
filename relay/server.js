import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

export const RELAY_PATH = "/v1/mobile-node";
export const REQUEST_PATH = "/v1/relay/request";
export const MAX_WS_PAYLOAD = 256 * 1024;
export const MAX_BODY = 192 * 1024;
export const MAX_PATH = 2048;
export const MAX_HEADERS = 64;
export const REQUEST_TIMEOUT_MS = 65_000;
export const AUTH_TIMEOUT_MS = 5_000;
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const MAX_PENDING = 64;

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function validPath(path) {
  return typeof path === "string"
    && path.length > 0
    && path.length <= MAX_PATH
    && path.startsWith("/v1/");
}

function validHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return false;
  return Object.keys(headers).length <= MAX_HEADERS
    && Object.entries(headers).every(([key, value]) => {
      return typeof key === "string"
        && key.length > 0
        && key.length <= 128
        && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)
        && (typeof value === "string" || Array.isArray(value))
        && String(value).length <= 8192;
    });
}

function jsonResponse(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  });
  res.end(JSON.stringify(body));
}

async function readBody(req, maxBytes) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error("Request body too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function createRelayServer({
  host = process.env.HOST || "0.0.0.0",
  port = Number(process.env.PORT || 18090),
  nodeToken = process.env.BHAI_RELAY_NODE_TOKEN || "",
  clientToken = process.env.BHAI_RELAY_CLIENT_TOKEN || ""
} = {}) {
  const pending = new Map();
  let active = null;
  let activeConnectedAt = 0;
  let activeLastSeenAt = 0;
  let sequence = 0;

  function nodeConnected() {
    return Boolean(active && active.readyState === WebSocket.OPEN);
  }

  function nodeInfo() {
    return {
      connected: nodeConnected(),
      pending: pending.size,
      connectedAt: activeConnectedAt || null,
      lastSeenAt: activeLastSeenAt || null
    };
  }

  function rejectUpgrade(socket, status = 404) {
    socket.write(
      "HTTP/1.1 " + status + " Not Found\r\n" +
      "Connection: close\r\n\r\n"
    );
    socket.destroy();
  }

  function failPending(error) {
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
      pending.delete(id);
    }
  }

  function requestNode({ path, method = "GET", headers = {}, body = null } = {}) {
    if (!nodeConnected()) {
      return Promise.reject(Object.assign(
        new Error("BHAI relay mobile node is not connected"),
        { status: 503 }
      ));
    }

    const normalizedMethod = String(method || "GET").toUpperCase();
    if (!ALLOWED_METHODS.has(normalizedMethod) || !validPath(path) || !validHeaders(headers)) {
      return Promise.reject(Object.assign(
        new Error("Invalid relay request"),
        { status: 400 }
      ));
    }

    if (body !== null && String(body).length > MAX_BODY) {
      return Promise.reject(Object.assign(
        new Error("Relay request body too large"),
        { status: 413 }
      ));
    }

    if (pending.size >= MAX_PENDING) {
      return Promise.reject(Object.assign(
        new Error("Relay request queue full"),
        { status: 429 }
      ));
    }

    const id = "relay-" + Date.now().toString(36) + "-" + (++sequence).toString(36);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Object.assign(
          new Error("Relay request timed out"),
          { status: 504 }
        ));
      }, REQUEST_TIMEOUT_MS);

      pending.set(id, { resolve, reject, timer });

      const safeHeaders = { ...headers };
      delete safeHeaders.authorization;
      delete safeHeaders.Authorization;

      try {
        active.send(JSON.stringify({
          type: "request",
          id,
          method: normalizedMethod,
          path,
          headers: safeHeaders,
          body
        }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_WS_PAYLOAD
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));

    if (url.pathname === "/health" && req.method === "GET") {
      return jsonResponse(res, 200, {
        ok: true,
        service: "BHAI-RELAY",
        configured: Boolean(nodeToken && clientToken),
        connected: nodeConnected()
      });
    }

    if (url.pathname !== REQUEST_PATH || req.method !== "POST") {
      return jsonResponse(res, 404, { ok: false, error: "not_found" });
    }

    if (!clientToken) {
      return jsonResponse(res, 503, { ok: false, error: "relay_not_configured" });
    }

    const auth = String(req.headers.authorization || "");
    const expected = "Bearer " + clientToken;
    if (!safeEqual(auth, expected)) {
      return jsonResponse(res, 401, { ok: false, error: "authentication_required" });
    }

    try {
      const raw = await readBody(req, MAX_BODY);
      const body = raw ? JSON.parse(raw) : {};

      const result = await requestNode({
        path: body.path,
        method: body.method,
        headers: body.headers || {},
        body: body.body ?? null
      });

      return jsonResponse(res, 200, {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        body: result.body
      });
    } catch (error) {
      const status = Number(error?.status) >= 400 ? Number(error.status) : 500;
      return jsonResponse(res, status, {
        ok: false,
        error: String(error?.message || "Relay request failed")
      });
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));
    if (url.pathname !== RELAY_PATH) return rejectUpgrade(socket);
    if (!nodeToken) return rejectUpgrade(socket, 503);

    wss.handleUpgrade(req, socket, head, ws => {
      let authenticated = false;
      let heartbeatTimer = null;

      const authTimer = setTimeout(() => {
        if (!authenticated) {
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

      ws.on("message", raw => {
        let message;
        try {
          message = JSON.parse(String(raw));
        } catch {
          ws.close(1003, "invalid json");
          return;
        }

        if (!message || typeof message !== "object" || Array.isArray(message)) {
          ws.close(1003, "invalid message");
          return;
        }

        if (!authenticated) {
          if (
            message.type !== "auth" ||
            typeof message.token !== "string" ||
            !safeEqual(message.token, nodeToken)
          ) {
            ws.close(1008, "authentication failed");
            return;
          }

          authenticated = true;
          clearTimeout(authTimer);

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

        if (message.type === "heartbeat") {
          try { ws.send(JSON.stringify({ type: "heartbeat_ack" })); } catch {}
          return;
        }

        if (
          message.type !== "response" ||
          typeof message.id !== "string" ||
          !message.id
        ) {
          return;
        }

        const waiter = pending.get(message.id);
        if (!waiter) return;

        pending.delete(message.id);
        clearTimeout(waiter.timer);

        const status = Number(message.status) || 502;
        const responseBody = String(message.body || "");

        if (responseBody.length > MAX_BODY) {
          waiter.reject(Object.assign(
            new Error("Relay response body too large"),
            { status: 502 }
          ));
          return;
        }

        waiter.resolve({
          status,
          body: responseBody
        });
      });

      ws.on("error", error => {
        console.error("BHAI relay websocket:", error?.message || error);
      });

      ws.on("close", () => {
        clearTimeout(authTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);

        if (active === ws) {
          active = null;
          activeConnectedAt = 0;
          activeLastSeenAt = 0;
          failPending(Object.assign(
            new Error("BHAI relay mobile node disconnected"),
            { status: 503 }
          ));
        }
      });
    });
  });

  return {
    server,
    nodeInfo,
    requestNode,
    async start() {
      await new Promise((resolve, reject) => {
        const onError = error => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
      return server.address();
    },
    async stop() {
      failPending(Object.assign(
        new Error("BHAI relay stopped"),
        { status: 503 }
      ));
      if (active) {
        try { active.close(1001, "server shutting down"); } catch {}
      }
      await new Promise(resolve => server.close(() => resolve()));
    }
  };
}

if (process.env.BHAI_RELAY_STANDALONE === "true") {
  try {
    const relay = createRelayServer();
    relay.start().then(address => {
      const shown = typeof address === "object" && address
        ? String(address.address) + ":" + String(address.port)
        : String(address);
      console.log("BHAI-RELAY listening on " + shown);
    });
  } catch (error) {
    console.error("BHAI-RELAY failed to start:", error?.message || error);
    process.exitCode = 1;
  }
}
