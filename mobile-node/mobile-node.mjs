const CORE_URL = String(process.env.BHAI_CORE_URL || "").replace(/\/+$/, "");
const NODE_TOKEN = String(process.env.BHAI_MOBILE_NODE_TOKEN || process.env.BHAI_ENGINE_API_KEY || "");
const LOCAL_ENGINE = String(process.env.BHAI_LOCAL_ENGINE_URL || "http://127.0.0.1:18080").replace(/\/+$/, "");
const LOCAL_ENGINE_API_KEY = String(process.env.BHAI_LOCAL_ENGINE_API_KEY || NODE_TOKEN);
const HEARTBEAT_INTERVAL_MS = 10000;

if (!CORE_URL) throw new Error("BHAI_CORE_URL is required");
if (!NODE_TOKEN) throw new Error("BHAI_MOBILE_NODE_TOKEN or BHAI_ENGINE_API_KEY is required");

const wsUrl = CORE_URL.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:") + "/v1/mobile-node";

let socket;
let stopping = false;
let reconnectTimer;
let heartbeatTimer;

function scheduleReconnect() {
  if (stopping || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

function localEngineHeaders(headers) {
  const result = headers && typeof headers === "object" ? { ...headers } : {};
  if (!result.authorization && LOCAL_ENGINE_API_KEY) {
    result.authorization = "Bearer " + LOCAL_ENGINE_API_KEY;
  }
  return result;
}

async function handleRequest(message) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 65000);
  try {
    const path = String(message.path || "/");
    if (!path.startsWith("/v1/")) throw new Error("path not allowed");
    const response = await fetch(LOCAL_ENGINE + path, {
      method: String(message.method || "GET"),
      headers: localEngineHeaders(message.headers),
      body: message.body == null ? undefined : String(message.body),
      signal: controller.signal
    });
    const body = await response.text();
    return {
      type: "response",
      id: String(message.id || ""),
      status: response.status,
      body
    };
  } catch (error) {
    return {
      type: "response",
      id: String(message.id || ""),
      status: 502,
      body: JSON.stringify({ error: String(error?.message || error) })
    };
  } finally {
    clearTimeout(timeout);
  }
}

function connect() {
  socket = new WebSocket(wsUrl);
  socket.addEventListener("open", () => {
    console.log("BHAI mobile node connected");
    socket.send(JSON.stringify({ type: "auth", token: NODE_TOKEN }));
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      try { socket.send(JSON.stringify({ type: "heartbeat" })); } catch {}
    }, HEARTBEAT_INTERVAL_MS);
  });
  socket.addEventListener("message", async event => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message?.type !== "request") return;
    const response = await handleRequest(message);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(response));
  });
  socket.addEventListener("error", error => {
    console.error("BHAI mobile node websocket:", error?.message || error);
  });
  socket.addEventListener("close", () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log("BHAI mobile node disconnected; retrying");
    scheduleReconnect();
  });
}

process.on("SIGTERM", () => { stopping = true; if (heartbeatTimer) clearInterval(heartbeatTimer); socket?.close(); });
process.on("SIGINT", () => { stopping = true; if (heartbeatTimer) clearInterval(heartbeatTimer); socket?.close(); });

connect();
