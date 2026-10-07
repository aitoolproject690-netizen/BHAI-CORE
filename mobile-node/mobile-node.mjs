import fs from "node:fs";

const CORE_URL = String(process.env.BHAI_CORE_URL || "").replace(/\/+$/, "");
const NODE_TOKEN = String(process.env.BHAI_MOBILE_NODE_TOKEN || process.env.BHAI_ENGINE_API_KEY || "");
const LOCAL_ENGINE = String(process.env.BHAI_LOCAL_ENGINE_URL || "http://127.0.0.1:18080").replace(/\/+$/, "");

function readSecretFile(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

// WebSocket auth and llama-server auth are separate secrets on the phone.
// Prefer an explicit local-engine key, then the standard engine-key file.
const LOCAL_ENGINE_API_KEY = String(
  process.env.BHAI_LOCAL_ENGINE_API_KEY ||
  (process.env.HOME ? readSecretFile(`${process.env.HOME}/.config/bhai/engine-key`) : "") ||
  NODE_TOKEN
);
const HEARTBEAT_INTERVAL_MS = 10000;

if (!CORE_URL) throw new Error("BHAI_CORE_URL is required");
if (!NODE_TOKEN) throw new Error("BHAI_MOBILE_NODE_TOKEN or BHAI_ENGINE_API_KEY is required");
if (!LOCAL_ENGINE_API_KEY) throw new Error("BHAI local engine API key is required");

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
  // Never trust/forward a remote Authorization header to the local engine.
  result.authorization = "Bearer " + LOCAL_ENGINE_API_KEY;
  return result;
}

async function handleRequest(message) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 65000);
  try {
    const path = String(message.path || "/");
    const method = String(message.method || "GET").toUpperCase();
    if (!path.startsWith("/v1/")) throw new Error("path not allowed");

    console.log("BHAI mobile node request", String(message.id || ""), method, path);
    const response = await fetch(LOCAL_ENGINE + path, {
      method,
      headers: localEngineHeaders(message.headers),
      body: message.body == null ? undefined : String(message.body),
      signal: controller.signal
    });
    const body = await response.text();
    console.log("BHAI mobile node response", String(message.id || ""), response.status);

    return {
      type: "response",
      id: String(message.id || ""),
      status: response.status,
      body
    };
  } catch (error) {
    console.error("BHAI mobile node request failed", String(message.id || ""), String(error?.message || error).slice(0, 240));
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

    if (message?.type === "heartbeat_ack") {
      console.log("BHAI mobile node heartbeat ok");
      return;
    }
    if (message?.type !== "request") return;

    const response = await handleRequest(message);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(response));
  });

  socket.addEventListener("error", error => {
    console.error("BHAI mobile node websocket:", error?.message || error);
  });

  socket.addEventListener("close", event => {
    console.log("BHAI mobile node close:", Number(event.code || 0), String(event.reason || ""));
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log("BHAI mobile node disconnected; retrying");
    scheduleReconnect();
  });
}

process.on("SIGTERM", () => {
  stopping = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  socket?.close();
});
process.on("SIGINT", () => {
  stopping = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  socket?.close();
});

connect();
