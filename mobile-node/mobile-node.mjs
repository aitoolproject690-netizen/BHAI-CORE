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
const LOCAL_ENGINE_RETRIES = 3;
const LOCAL_ENGINE_RETRY_DELAYS_MS = [350, 900, 1600];

const NODE_ID = String(process.env.BHAI_MOBILE_NODE_ID || "mobile-node").trim();
const NODE_VERSION = String(process.env.BHAI_MOBILE_NODE_VERSION || "1.1.0").trim();

const MOBILE_ENGINES = [
  {
    id: "smollm2",
    name: "SmolLM2",
    kind: "llm",
    model: process.env.BHAI_LOCAL_MODEL || "smollm2.gguf",
    backend: "llama.cpp-vulkan",
    capabilities: ["chat", "gpu"],
    ready: true,
    loaded: true,
    memory_mb: 512
  },
  {
    id: "local-image",
    name: "Local Dream SD1.5",
    kind: "image",
    model: process.env.BHAI_LOCAL_IMAGE_MODEL || "sd1.5",
    backend: "local-dream",
    capabilities: ["image-text-to-image", "gpu"],
    ready: Boolean(LOCAL_IMAGE_ENGINE_READY && LOCAL_IMAGE_ENGINE),
    loaded: Boolean(LOCAL_IMAGE_ENGINE_READY && LOCAL_IMAGE_ENGINE),
    memory_mb: Number(process.env.BHAI_LOCAL_IMAGE_MEMORY_MB || 2048)
  }
];

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

function localEngineHeaders(headers, imageEngine = false) {
  const result = headers && typeof headers === "object" ? { ...headers } : {};
  // Never trust/forward a remote Authorization header to a local engine.
  delete result.authorization;
  if (imageEngine) {
    if (LOCAL_IMAGE_ENGINE_API_KEY) result.authorization = "Bearer " + LOCAL_IMAGE_ENGINE_API_KEY;
  } else {
    result.authorization = "Bearer " + LOCAL_ENGINE_API_KEY;
  }
  return result;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableLocalEngineError(error) {
  const message = String(error?.message || error).toLowerCase();
  const cause = String(error?.cause?.code || error?.cause?.message || "").toLowerCase();
  return /fetch failed|econnrefused|econnreset|enotfound|etimedout|socket|network|timed?out|aborted/.test(message + " " + cause);
}

async function handleRequest(message) {
  const path = String(message.path || "/");
  const method = String(message.method || "GET").toUpperCase();
  const imageEngine = path === "/generate";
  if (!path.startsWith("/v1/") && !imageEngine) {
    return {
      type: "response",
      id: String(message.id || ""),
      status: 400,
      body: JSON.stringify({ error: "path not allowed" })
    };
  }
  if (imageEngine && !LOCAL_IMAGE_ENGINE_READY) {
    return {
      type: "response",
      id: String(message.id || ""),
      status: 503,
      body: JSON.stringify({ error: "Local image engine is not marked ready on this mobile node" })
    };
  }

  const engineBase = imageEngine ? LOCAL_IMAGE_ENGINE : LOCAL_ENGINE;
  const timeoutMs = imageEngine ? 240000 : 65000;
  console.log("BHAI mobile node request", String(message.id || ""), method, path, imageEngine ? "image-engine" : "llm-engine");
  let lastError = null;

  for (let attempt = 1; attempt <= LOCAL_ENGINE_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(engineBase + path, {
        method,
        headers: localEngineHeaders(message.headers, imageEngine),
        body: message.body == null ? undefined : String(message.body),
        signal: controller.signal
      });
      const body = await response.text();
      console.log("BHAI mobile node response", String(message.id || ""), response.status, "attempt="+attempt);

      if (response.ok || attempt === LOCAL_ENGINE_RETRIES || response.status < 500) {
        return {
          type: "response",
          id: String(message.id || ""),
          status: response.status,
          body
        };
      }

      lastError = new Error("local engine HTTP " + response.status);
    } catch (error) {
      lastError = error;
      if (!isRetryableLocalEngineError(error) || attempt === LOCAL_ENGINE_RETRIES) break;
      console.warn("BHAI mobile node local engine retry", String(message.id || ""), "attempt="+attempt, String(error?.message || error).slice(0, 180));
    } finally {
      clearTimeout(timeout);
    }

    await sleep(LOCAL_ENGINE_RETRY_DELAYS_MS[attempt - 1] || 1200);
  }

  const messageText = String(lastError?.message || lastError || "local engine request failed").slice(0, 240);
  console.error("BHAI mobile node request failed", String(message.id || ""), messageText);
  return {
    type: "response",
    id: String(message.id || ""),
    status: 502,
    body: JSON.stringify({ error: messageText })
  };
}

function connect() {
  socket = new WebSocket(wsUrl);
  socket.addEventListener("open", () => {
    console.log("BHAI mobile node connected");
    socket.send(JSON.stringify({
      type: "auth",
      token: NODE_TOKEN,
      nodeId: NODE_ID,
      model: process.env.BHAI_LOCAL_MODEL || "smollm2.gguf",
      capabilities: ["chat", "streaming", "local", "gpu", "vulkan"],
      engines: MOBILE_ENGINES,
      platform: "android-termux",
      version: NODE_VERSION
    }));
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      try { socket.send(JSON.stringify({ type: "heartbeat" })); } catch {}
    }, HEARTBEAT_INTERVAL_MS);
  });

  socket.addEventListener("message", async event => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }

    if (message?.type === "auth_ok") {
      console.log("BHAI mobile node auth ok", JSON.stringify({
        nodeId: message.nodeId || NODE_ID,
        pairedBy: message.pairedBy || "token"
      }));
      return;
    }
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
