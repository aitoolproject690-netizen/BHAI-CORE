import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { updateMobileEngineRegistry, mobileEngineInfo, selectMobileEngine } from "./mobileEngines.js";

const PATH = "/v1/mobile-node";
const AUTH_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 65000;
const HEARTBEAT_INTERVAL_MS = 10000;
const CONNECT_WAIT_TIMEOUT_MS = 12000;
// Image-generation replies include base64 PNG data; allow bounded multi-megabyte payloads.
const MAX_WS_PAYLOAD = 8 * 1024 * 1024;
const MAX_BODY = 192 * 1024;
const MAX_PATH = 2048;
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const ALLOWED_REQUEST_PREFIX = "/v1/";

let active = null;
let activeConnectedAt = 0;
let activeLastSeenAt = 0;
let activeMeta = null;
let sequence = 0;
const pending = new Map();
const connectionWaiters = new Set();

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

function normalizedNodeId(value) {
  const nodeId = String(value || "").trim();
  if (!nodeId) return "";
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(nodeId)) return "";
  return nodeId;
}

function normalizedCapabilities(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value.map(item => String(item || "").trim().toLowerCase())
      .filter(item => /^[a-z0-9._:-]{1,64}$/.test(item))
  )].slice(0, 32);
}

function mobileNodeConfig() {
  return {
    expectedNodeId: normalizedNodeId(process.env.BHAI_MOBILE_NODE_ID || "")
  };
}

function reject(socket, status = 404) {
  socket.write("HTTP/1.1 " + status + " Not Found\r\nConnection: close\r\n\r\n");
  socket.destroy();
}

function validRequestPath(path) {
  return typeof path === "string" &&
    path.length > 0 &&
    path.length <= MAX_PATH &&
    (path.startsWith(ALLOWED_REQUEST_PREFIX) || path === "/generate");
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
          const configured = mobileNodeConfig();
          const announcedNodeId = normalizedNodeId(message.nodeId);
          const tokenValid = typeof message?.token === "string" && authenticatedToken(message.token);
          const nodeIdMatch = !configured.expectedNodeId || announcedNodeId === configured.expectedNodeId;
          if (message?.type !== "auth" || !tokenValid || !nodeIdMatch) {
            // Safe auth diagnostics: never log credentials or their fingerprints.
            console.warn("BHAI mobile node auth rejected", JSON.stringify({
              messageType: String(message?.type || "").slice(0, 32) || null,
              tokenValid,
              nodeIdConfigured: Boolean(configured.expectedNodeId),
              nodeIdPresent: Boolean(announcedNodeId),
              nodeIdMatch
            }));
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
          activeMeta = {
            nodeId: announcedNodeId || "mobile-node",
            model: String(message.model || "").trim().slice(0, 160) || null,
            capabilities: normalizedCapabilities(message.capabilities),
            engines: Array.isArray(message.engines) ? message.engines.slice(0,64) : [],
            platform: String(message.platform || "").trim().slice(0, 64) || null,
            version: String(message.version || "").trim().slice(0, 64) || null,
            pairedBy: configured.expectedNodeId ? "token+node-id" : "token"
          };
          updateMobileEngineRegistry(activeMeta.engines);
          startHeartbeat();
          ws.send(JSON.stringify({
            type: "auth_ok",
            nodeId: activeMeta.nodeId,
            pairedBy: activeMeta.pairedBy,
            serverTime: new Date().toISOString()
          }));
          for (const waiter of connectionWaiters) {
            clearTimeout(waiter.timer);
            waiter.resolve(ws);
          }
          connectionWaiters.clear();
          console.log("BHAI mobile node authenticated", JSON.stringify({
            nodeId: activeMeta.nodeId,
            engines: activeMeta.engines.map(engine => ({
              id: String(engine?.id || "").slice(0, 80),
              model: String(engine?.model || "").slice(0, 120),
              ready: engine?.ready === true,
              loaded: engine?.loaded === true,
              capabilities: normalizedCapabilities(engine?.capabilities)
            }))
          }));
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
          activeMeta = null;
          updateMobileEngineRegistry([]);
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
  const configured = mobileNodeConfig();
  return {
    configured: tokens().length > 0,
    paired: Boolean(active && active.readyState === WebSocket.OPEN),
    connected: Boolean(active && active.readyState === WebSocket.OPEN),
    pending: pending.size,
    connectedAt: activeConnectedAt || null,
    lastSeenAt: activeLastSeenAt || null,
    nodeId: activeMeta?.nodeId || configured.expectedNodeId || null,
    model: activeMeta?.model || null,
    capabilities: activeMeta?.capabilities || [],
    platform: activeMeta?.platform || null,
    version: activeMeta?.version || null,
    engines: mobileEngineInfo().engines,
    pairingMode: configured.expectedNodeId ? "token+node-id" : "token"
  };
}



export function mobileEngineRegistryInfo(){
  return mobileEngineInfo();
}

export function chooseMobileEngine(capability, model=null){
  return selectMobileEngine({capability,model});
}

async function waitForActive(timeoutMs = CONNECT_WAIT_TIMEOUT_MS) {
  if (active && active.readyState === WebSocket.OPEN) return active;

  return new Promise((resolve, reject) => {
    const waiter = {
      timer: setTimeout(() => {
        connectionWaiters.delete(waiter);
        reject(Object.assign(new Error("BHAI mobile node is not connected"), { status: 503 }));
      }, timeoutMs),
      resolve: socket => resolve(socket),
      reject
    };
    connectionWaiters.add(waiter);
  });
}

async function sendMobileNodeRequest({ path, method, headers, body }) {
  const socket = await waitForActive();
  const id = "mn-" + Date.now().toString(36) + "-" + (++sequence).toString(36);

  return new Promise((resolve, rejectPromise) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectPromise(Object.assign(new Error("BHAI mobile node request timed out"), { status: 504 }));
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, { resolve, reject: rejectPromise, timer });

    try {
      socket.send(JSON.stringify({
        type: "request",
        id,
        method,
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

export async function requestMobileNode({ path, method = "GET", headers = {}, body = null } = {}) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(normalizedMethod) || !validRequestPath(path) || !validHeaders(headers)) {
    throw Object.assign(new Error("Invalid mobile node request"), { status: 400 });
  }

  if (body !== null && String(body).length > MAX_BODY) {
    throw Object.assign(new Error("Mobile node request body too large"), { status: 413 });
  }

  try {
    return await sendMobileNodeRequest({ path, method: normalizedMethod, headers, body });
  } catch (firstError) {
    if (Number(firstError?.status || 0) >= 400 && Number(firstError?.status || 0) < 500) throw firstError;
    console.warn("BHAI mobile node request retrying after connection issue", JSON.stringify({
      status: Number(firstError?.status || 0) || null,
      error: String(firstError?.message || firstError).slice(0, 200)
    }));
    return sendMobileNodeRequest({ path, method: normalizedMethod, headers, body });
  }
}
