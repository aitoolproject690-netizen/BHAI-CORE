import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getLlama, LlamaChatSession } from "node-llama-cpp";

const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.HOST || "0.0.0.0";
const API_KEY = process.env.BHAI_ENGINE_API_KEY || "";
const MODEL_PATH = process.env.BHAI_ENGINE_MODEL_PATH ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "models", "smollm2-135m-instruct-q4_k_m.gguf");
const MODEL_NAME = process.env.BHAI_ENGINE_MODEL || "smollm2-135m-instruct-q4_k_m";
const MAX_BODY = Number(process.env.BHAI_ENGINE_MAX_BODY || 512 * 1024);
const MAX_TOKENS = Number(process.env.BHAI_ENGINE_MAX_TOKENS || 256);

let model;
let llama;
let modelLoadPromise;

function authorized(req) {
  return Boolean(API_KEY && req.headers.authorization === "Bearer " + API_KEY);
}

function send(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload), ...headers });
  res.end(payload);
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY) throw Object.assign(new Error("Request body too large"), { status: 413 });
  }
  return body ? JSON.parse(body) : {};
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter(m => m && typeof m.content === "string")
    .map(m => `${String(m.role || "user").toUpperCase()}: ${m.content}`)
    .join("\n\n");
}

async function ensureModel() {
  if (model) return;
  if (modelLoadPromise) return modelLoadPromise;
  modelLoadPromise = (async () => {
    llama = await getLlama();
    model = await llama.loadModel({ modelPath: MODEL_PATH });
    console.log(JSON.stringify({ event: "model_loaded", model: MODEL_NAME }));
  })().catch(error => {
    modelLoadPromise = undefined;
    throw error;
  });
  return modelLoadPromise;
}

async function chat(body, res) {
  await ensureModel();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) throw Object.assign(new Error("messages must be a non-empty array"), { status: 400 });
  const system = messages.find(m => m?.role === "system")?.content ||
    "You are BHAI, a concise helpful AI assistant. Be honest when uncertain.";
  const userMessages = messages.filter(m => m?.role !== "system");
  const prompt = normalizeMessages(userMessages);
  const context = await model.createContext();
  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt: system
  });

  if (body.stream) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "connection": "keep-alive"
    });
    await session.prompt(prompt, {
      temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.7,
      maxTokens: Math.min(Math.max(Number(body.max_tokens) || MAX_TOKENS, 1), MAX_TOKENS),
      onTextChunk(chunk) {
        res.write("data: " + JSON.stringify({ choices: [{ delta: { content: chunk } }] }) + "\n\n");
      }
    });
    res.write("data: [DONE]\n\n");
    res.end();
    session.dispose();
    context.dispose();
    return;
  }

  const text = await session.prompt(prompt, {
    temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.7,
    maxTokens: Math.min(Math.max(Number(body.max_tokens) || MAX_TOKENS, 1), MAX_TOKENS)
  });
  session.dispose();
  context.dispose();
  send(res, 200, {
    id: "bhai-engine-" + Date.now(),
    object: "chat.completion",
    model: MODEL_NAME,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }]
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/health" && req.method === "GET") {
      send(res, model ? 200 : 503, { ok: Boolean(model), service: "BHAI Engine", model: MODEL_NAME, model_loaded: Boolean(model) });
      return;
    }
    if (req.url === "/ready" && req.method === "GET") {
      await ensureModel();
      return send(res, 200, { ok: true, service: "BHAI Engine", model: MODEL_NAME, model_loaded: true });
    }
    if (req.url === "/v1/models" && req.method === "GET") {
      if (!authorized(req)) return send(res, 401, { error: { message: "Unauthorized" } });
      return send(res, 200, { object: "list", data: [{ id: MODEL_NAME, object: "model", owned_by: "BHAI" }] });
    }
    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      if (!authorized(req)) return send(res, 401, { error: { message: "Unauthorized" } });
      await chat(await readBody(req), res);
      return;
    }
    send(res, 404, { error: { message: "Not found" } });
  } catch (error) {
    if (!res.headersSent) send(res, Number(error.status) || 500, { error: { message: error.message || "Engine error" } });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`BHAI Engine listening on http://${HOST}:${PORT}`);
  ensureModel().catch(error => console.error(JSON.stringify({ event: "model_load_failed", error: error.message })));
});
