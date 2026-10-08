import crypto from "node:crypto";
import { deflateSync } from "node:zlib";
import { getStore, updateStore } from "./store.js";
import { requestMobileNode, mobileNodeInfo } from "./mobileNode.js";

const MAX_PROMPT_CHARS = Number(process.env.BHAI_MAX_IMAGE_PROMPT_CHARS || 4000);

const LOCAL_DREAM_PATH = "/generate";
const LOCAL_DREAM_DEFAULTS = Object.freeze({
  steps: Number(process.env.BHAI_LOCAL_IMAGE_STEPS || 20),
  cfg: Number(process.env.BHAI_LOCAL_IMAGE_CFG || 7.5),
  scheduler: String(process.env.BHAI_LOCAL_IMAGE_SCHEDULER || "dpm")
});

function imageDimensions() {
  return { width: 512, height: 512, size: 512 };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const payload = Buffer.concat([typeBuffer, data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuffer.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(payload), 8 + data.length);
  return out;
}

export function rawRgbToPng(rawBase64, width, height) {
  const w = Number(width), h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 2048 || h > 2048) {
    throw new Error("Invalid Local Dream image dimensions.");
  }
  const raw = Buffer.from(String(rawBase64 || ""), "base64");
  const expected = w * h * 3;
  if (raw.length !== expected) throw new Error("Local Dream returned unexpected raw RGB size.");
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    rows[y * (w * 3 + 1)] = 0;
    raw.copy(rows, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(rows, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
  return png;
}

export function parseLocalDreamSse(raw) {
  const events = [];
  const blocks = String(raw || "").split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const dataLine = block.split(/\r?\n/).find(line => line.startsWith("data:"));
    if (!dataLine) continue;
    const payload = dataLine.slice(5).trim();
    if (!payload) continue;
    try { events.push(JSON.parse(payload)); } catch {
      throw new Error("Local Dream returned malformed SSE data.");
    }
  }
  const errorEvent = [...events].reverse().find(e => e?.type === "error" || e?.message && /error/i.test(String(e?.type || "")));
  if (errorEvent) throw new Error(String(errorEvent.message || "Local Dream generation failed."));
  const complete = [...events].reverse().find(e => e?.type === "complete" && e?.image);
  if (!complete) throw new Error("Local Dream returned no completed image.");
  return complete;
}

export function localDreamRequestPayload(request = {}) {
  const dims = imageDimensions();
  return {
    prompt: String(request.prompt || "").trim().slice(0, 1200),
    negative_prompt: String(request.negativePrompt || "low quality, blurry, bad anatomy").trim().slice(0, 800),
    size: dims.size,
    steps: Number.isInteger(Number(request.steps)) ? Math.max(1, Math.min(30, Number(request.steps))) : LOCAL_DREAM_DEFAULTS.steps,
    cfg: Number.isFinite(Number(request.cfg)) ? Math.max(1, Math.min(15, Number(request.cfg))) : LOCAL_DREAM_DEFAULTS.cfg,
    scheduler: String(request.scheduler || LOCAL_DREAM_DEFAULTS.scheduler),
    seed: Number.isInteger(Number(request.seed)) ? request.seed >>> 0 : Math.floor(Math.random() * 2 ** 31),
    use_opencl: false
  };
}


function cleanUrl(url) {
  return String(url || "http://127.0.0.1:8188").replace(/\/$/, "");
}

function normalizePrompt(prompt) {
  const value = String(prompt || "").trim();
  if (!value) throw new Error("prompt is required");
  if (value.length > MAX_PROMPT_CHARS) throw new Error("prompt is too long");
  return value;
}

function defaultWorkflow(prompt, seed) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: process.env.COMFYUI_CHECKPOINT || "model.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 1] } },
    "3": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "4": { class_type: "KSampler", inputs: { seed, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["1", 0], positive: ["2", 0], negative: ["5", 0], latent_image: ["3", 0] } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["1", 1] } },
    "6": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { filename_prefix: "bhai", images: ["6", 0] } }
  };
}

export function createImageRequest({ prompt, provider = "comfyui", model, seed }) {
  return {
    id: "img_" + crypto.randomUUID(),
    provider: String(provider).toLowerCase(),
    model: model || null,
    prompt: normalizePrompt(prompt),
    seed: Number.isInteger(seed) ? seed : Math.floor(Math.random() * 2 ** 31)
  };
}

export async function submitMobileImage({ request }) {
  const payload = localDreamRequestPayload(request);
  const response = await requestMobileNode({
    path: LOCAL_DREAM_PATH,
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(payload)
  });
  const raw = await response.text();
  if (!response.ok) {
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch {}
    throw Object.assign(new Error(data?.error || data?.message || "Local Dream image engine failed"), { status: response.status });
  }
  const complete = parseLocalDreamSse(raw);
  const channels = Number(complete.channels || 3);
  if (channels !== 3) throw new Error("Local Dream returned unsupported pixel channels: " + channels);
  const png = rawRgbToPng(complete.image, complete.width, complete.height);
  const jobId = "ld-" + request.id.slice(4);
  return {
    provider: "mobile-local-dream",
    jobId,
    seed: Number.isInteger(complete.seed) ? complete.seed : payload.seed,
    status: "completed",
    output: {
      mimeType: "image/png",
      data: png.toString("base64"),
      width: Number(complete.width),
      height: Number(complete.height),
      generationTimeMs: Number(complete.generation_time_ms || 0)
    }
  };
}

export async function getMobileImageJob({ jobId }) {
  const response = await requestMobileNode({ path: "/v1/image/jobs/" + encodeURIComponent(String(jobId)), method: "GET", headers: {} });
  const raw = await response.text();
  let data; try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!response.ok) throw Object.assign(new Error(data?.error || data?.message || "Mobile image job lookup failed"), { status: response.status });
  return { provider: "mobile", jobId: String(jobId), job: data };
}

export async function submitComfyUI({ url, request, workflow }) {
  const payload = workflow || defaultWorkflow(request.prompt, request.seed);
  const response = await fetch(cleanUrl(url) + "/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: payload, client_id: "bhai-core" }),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.error || data?.raw || "ComfyUI submission failed");
    error.status = response.status;
    throw error;
  }
  if (!data.prompt_id) throw new Error("ComfyUI returned no prompt_id");
  return { provider: "comfyui", promptId: data.prompt_id, seed: request.seed };
}

export function imageProviderInfo() {
  return {
    mobile: {
      local: true,
      configured: mobileNodeInfo().configured,
      connected: mobileNodeInfo().connected,
      mode: "mobile-node",
      capabilities: ["image-text-to-image","image-image-to-image"]
    },
    comfyui: {
      local: true,
      url: cleanUrl(process.env.COMFYUI_URL),
      configured: Boolean(process.env.COMFYUI_URL || process.env.COMFYUI_ENABLED === "true")
    }
  };
}

export async function recordImageJobOwnership({ promptId, ownerId, requestId = null, provider = "comfyui" }) {
  const id = String(promptId || "").trim();
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid image job id");
  if (!ownerId) throw new Error("ownerId is required");
  await updateStore(store => {
    store.imageJobs ??= {};
    store.imageJobs[id] = {
      promptId: id,
      ownerId: String(ownerId),
      requestId: requestId || null,
      provider: String(provider || "comfyui").toLowerCase(),
      createdAt: new Date().toISOString()
    };
    return store;
  });
  return { promptId: id, ownerId: String(ownerId) };
}

export async function getImageJobOwnership(promptId, ownerId) {
  const id = String(promptId || "").trim();
  const store = await getStore();
  const job = store.imageJobs?.[id];
  if (!job || job.ownerId !== ownerId) return null;
  return { ...job };
}

export async function getComfyUIHistory({ url, promptId }) {
  const id = String(promptId || "").trim();
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid image job id");
  const response = await fetch(cleanUrl(url) + "/history/" + encodeURIComponent(id), {
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.error || data?.raw || "ComfyUI history request failed");
    error.status = response.status;
    throw error;
  }
  return { provider: "comfyui", promptId: id, history: data };
}
