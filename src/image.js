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

function imageDimensions(request = {}) {
  const presets = {
    "1:1": [1024, 1024],
    "16:9": [1280, 720],
    "9:16": [720, 1280],
    "4:3": [1152, 864],
    "3:2": [1152, 768],
    "2:3": [768, 1152]
  };
  const ratio = String(request.aspectRatio || "").trim();
  const [presetWidth, presetHeight] = presets[ratio] || [1024, 1024];
  const width = request.width == null ? presetWidth : Number(request.width);
  const height = request.height == null ? presetHeight : Number(request.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < 512 || height < 512 || width > 1536 || height > 1536 ||
      width % 8 !== 0 || height % 8 !== 0 || width * height > 1_572_864) {
    throw new Error("Image width and height must be multiples of 8 between 512 and 1536, with at most 1.57 megapixels.");
  }
  return { width, height };
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
  let dataLines = [];
  let eventName = "";
  const flush = () => {
    if (!dataLines.length) {
      eventName = "";
      return;
    }
    const payload = dataLines.join("\n").trim();
    dataLines = [];
    const name = eventName;
    eventName = "";
    if (!payload) return;
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === "object" && !parsed.type && name) {
        parsed.type = name;
      }
      events.push(parsed);
    } catch {
      throw new Error("Local Dream returned malformed SSE data.");
    }
  };
  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  // SSE streams may end immediately after the final data line without a blank delimiter.
  flush();

  const errorEvent = [...events].reverse().find(e =>
    e?.type === "error" || (e?.message && /error/i.test(String(e?.type || "")))
  );
  if (errorEvent) throw new Error(String(errorEvent.message || "Local Dream generation failed."));
  const complete = [...events].reverse().find(e =>
    (e?.type === "complete" || e?.type === "completed" || e?.event === "complete") && e?.image
  );
  if (!complete) throw new Error("Local Dream returned no completed image.");
  return complete;
}

export function localDreamRequestPayload(request = {}) {
  // Keep the optional legacy mobile adapter bounded to 512px; it is not the GPU image backend.
  const dims = { width: 512, height: 512, size: 512 };
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
  const value = String(url || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw Object.assign(new Error("COMFYUI_URL must be a valid HTTP(S) URL."), { status: 503 });
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw Object.assign(new Error("COMFYUI_URL must use HTTP(S) without embedded credentials."), { status: 503 });
  }
  return parsed.toString().replace(/\/+$/, "");
}

function normalizePrompt(prompt) {
  const value = String(prompt || "").trim();
  if (!value) throw new Error("prompt is required");
  if (value.length > MAX_PROMPT_CHARS) throw new Error("prompt is too long");
  return value;
}

export function buildComfyUIWorkflow(request = {}, env = process.env) {
  const prompt = normalizePrompt(request.prompt);
  const seed = Number.isInteger(request.seed) ? request.seed : Math.floor(Math.random() * 2 ** 31);
  const { width, height } = imageDimensions(request);
  const preset = String(env.BHAI_IMAGE_WORKFLOW || "checkpoint").trim().toLowerCase();

  if (preset === "flux-schnell") {
    const rawSteps = Number(env.BHAI_IMAGE_STEPS || 4);
    const steps = Number.isInteger(rawSteps) ? Math.max(1, Math.min(8, rawSteps)) : 4;
    return {
      "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: String(env.COMFYUI_CHECKPOINT || "flux1-schnell-fp8.safetensors") } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 1] } },
      "3": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
      "4": { class_type: "KSampler", inputs: { seed, steps, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1, model: ["1", 0], positive: ["2", 0], negative: ["5", 0], latent_image: ["3", 0] } },
      "5": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["1", 1] } },
      "6": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["1", 2] } },
      "7": { class_type: "SaveImage", inputs: { filename_prefix: "bhai", images: ["6", 0] } }
    };
  }

  if (preset !== "checkpoint") {
    throw Object.assign(new Error("Unsupported BHAI_IMAGE_WORKFLOW. Use checkpoint or flux-schnell."), { status: 503 });
  }
  const rawSteps = Number(env.BHAI_IMAGE_STEPS || 20);
  const steps = Number.isInteger(rawSteps) ? Math.max(1, Math.min(50, rawSteps)) : 20;
  const rawCfg = Number(env.BHAI_IMAGE_CFG || 7);
  const cfg = Number.isFinite(rawCfg) ? Math.max(1, Math.min(15, rawCfg)) : 7;
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: String(env.COMFYUI_CHECKPOINT || "model.safetensors") } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 1] } },
    "3": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "4": { class_type: "KSampler", inputs: { seed, steps, cfg, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["1", 0], positive: ["2", 0], negative: ["5", 0], latent_image: ["3", 0] } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: String(request.negativePrompt || "low quality, blurry, bad anatomy").slice(0, 800), clip: ["1", 1] } },
    "6": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { filename_prefix: "bhai", images: ["6", 0] } }
  };
}

export function createImageRequest({ prompt, provider = "comfyui", model, seed, width, height, aspectRatio, negativePrompt }) {
  const dimensions = imageDimensions({ width, height, aspectRatio });
  return {
    id: "img_" + crypto.randomUUID(),
    provider: String(provider).toLowerCase(),
    model: model || null,
    prompt: normalizePrompt(prompt),
    negativePrompt: String(negativePrompt || "").trim().slice(0, 800),
    ...dimensions,
    aspectRatio: aspectRatio || "1:1",
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

export async function submitComfyUI({ url, request, fetchImpl = globalThis.fetch, env = process.env }) {
  const endpoint = cleanUrl(url);
  if (!endpoint) throw Object.assign(new Error("Self-hosted image engine is not configured. Set COMFYUI_URL to your own ComfyUI server."), { status: 503 });
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable for the self-hosted image engine.");
  // Never accept raw ComfyUI graphs from public API callers: graphs may access local files or custom nodes.
  const payload = buildComfyUIWorkflow(request, env);
  const response = await fetchImpl(endpoint + "/prompt", {
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

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function generateComfyUIImage({
  url,
  request,
  timeoutMs = 240000,
  pollIntervalMs = 1000,
  fetchImpl = globalThis.fetch,
  env = process.env
} = {}) {
  const endpoint = cleanUrl(url);
  if (!endpoint) throw Object.assign(new Error("Self-hosted image engine is not configured. Set COMFYUI_URL to your own ComfyUI server."), { status: 503 });
  const startedAt = Date.now();
  const submitted = await submitComfyUI({ url: endpoint, request, fetchImpl, env });
  const budgetMs = Number(timeoutMs) > 0 ? Math.min(Number(timeoutMs), 360000) : 240000;
  const deadline = Date.now() + budgetMs;

  while (Date.now() < deadline) {
    const response = await fetchImpl(endpoint + "/history/" + encodeURIComponent(submitted.promptId), {
      signal: AbortSignal.timeout(15000)
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!response.ok) throw Object.assign(new Error("ComfyUI history failed with HTTP " + response.status), { status: 502 });

    const job = data?.[submitted.promptId];
    const statusText = String(job?.status?.status_str || "").toLowerCase();
    if (statusText === "error") {
      throw Object.assign(new Error("ComfyUI reported an image-generation error."), { status: 502 });
    }

    const images = Object.values(job?.outputs || {}).flatMap(output =>
      Array.isArray(output?.images) ? output.images : []
    );
    const descriptor = images.find(item => String(item?.type || "output") === "output");
    if (descriptor) {
      const filename = String(descriptor.filename || "");
      const subfolder = String(descriptor.subfolder || "");
      if (!filename || filename.length > 255 || /[\\/]|\.\./.test(filename) ||
          subfolder.length > 160 || subfolder.startsWith("/") || subfolder.includes("..") ||
          /[^A-Za-z0-9_./ -]/.test(subfolder) || subfolder.includes("\\")) {
        throw Object.assign(new Error("ComfyUI returned an invalid image output path."), { status: 502 });
      }
      const query = new URLSearchParams({ filename, subfolder, type: "output" });
      const imageResponse = await fetchImpl(endpoint + "/view?" + query.toString(), {
        signal: AbortSignal.timeout(30000)
      });
      if (!imageResponse.ok) throw Object.assign(new Error("ComfyUI image output download failed with HTTP " + imageResponse.status), { status: 502 });
      const bytes = Buffer.from(await imageResponse.arrayBuffer());
      if (!bytes.length || bytes.length > 12 * 1024 * 1024) {
        throw Object.assign(new Error("ComfyUI image output is empty or exceeds the 12 MB limit."), { status: 502 });
      }
      const mimeType = String(imageResponse.headers?.get?.("content-type") || "image/png").split(";")[0].toLowerCase();
      const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const jpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
        bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
      const webp = bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP";
      if (!((mimeType === "image/png" && png) || (mimeType === "image/jpeg" && jpeg) ||
          (mimeType === "image/webp" && webp))) {
        throw Object.assign(new Error("ComfyUI image output failed media signature verification."), { status: 502 });
      }
      return {
        provider: "comfyui",
        promptId: submitted.promptId,
        seed: submitted.seed,
        status: "completed",
        output: {
          mimeType,
          data: bytes.toString("base64"),
          width: Number(request.width) || null,
          height: Number(request.height) || null,
          generationTimeMs: Date.now() - startedAt
        }
      };
    }

    if (job?.status?.completed === true && images.length === 0) {
      throw Object.assign(new Error("ComfyUI completed the job without producing an image."), { status: 502 });
    }
    await pause(Math.max(250, Math.min(5000, Number(pollIntervalMs) || 1000)));
  }
  throw Object.assign(new Error("Timed out waiting for the self-hosted image engine."), { status: 504 });
}

function configuredComfyUIImage(env = process.env) {
  const workflow = String(env.BHAI_IMAGE_WORKFLOW || "checkpoint").trim().toLowerCase();
  return {
    workflow,
    model: String(env.COMFYUI_CHECKPOINT || (workflow === "flux-schnell" ? "flux1-schnell-fp8.safetensors" : "model.safetensors"))
  };
}

/** Verify that ComfyUI is reachable, has the requested checkpoint, and sees an NVIDIA CUDA device. */
export async function probeComfyUI({
  url = process.env.COMFYUI_URL,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000
} = {}) {
  const config = configuredComfyUIImage(env);
  const configured = Boolean(String(url || "").trim());
  if (!configured) {
    return { provider: "comfyui", configured: false, reachable: false, gpuAvailable: false,
      modelAvailable: false, ready: false, workflow: config.workflow, model: config.model,
      reason: "image_engine_not_configured" };
  }

  let endpoint;
  try {
    endpoint = cleanUrl(url);
  } catch {
    return { provider: "comfyui", configured: true, reachable: false, gpuAvailable: false,
      modelAvailable: false, ready: false, workflow: config.workflow, model: config.model,
      reason: "image_engine_url_invalid" };
  }
  if (!endpoint || typeof fetchImpl !== "function") {
    return { provider: "comfyui", configured: true, reachable: false, gpuAvailable: false,
      modelAvailable: false, ready: false, workflow: config.workflow, model: config.model,
      reason: "image_engine_unreachable" };
  }

  let statsResponse, modelResponse;
  try {
    [statsResponse, modelResponse] = await Promise.all([
      fetchImpl(endpoint + "/system_stats", { signal: AbortSignal.timeout(timeoutMs) }),
      fetchImpl(endpoint + "/object_info/CheckpointLoaderSimple", { signal: AbortSignal.timeout(timeoutMs) })
    ]);
  } catch {
    return { provider: "comfyui", configured: true, reachable: false, gpuAvailable: false,
      modelAvailable: false, ready: false, workflow: config.workflow, model: config.model,
      reason: "image_engine_unreachable" };
  }
  if (!statsResponse.ok || !modelResponse.ok) {
    return { provider: "comfyui", configured: true, reachable: false, gpuAvailable: false,
      modelAvailable: false, ready: false, workflow: config.workflow, model: config.model,
      reason: "image_engine_probe_http_error" };
  }

  let stats, objectInfo;
  try {
    [stats, objectInfo] = await Promise.all([statsResponse.json(), modelResponse.json()]);
  } catch {
    return { provider: "comfyui", configured: true, reachable: false, gpuAvailable: false,
      modelAvailable: false, ready: false, workflow: config.workflow, model: config.model,
      reason: "image_engine_probe_invalid_json" };
  }

  const devices = Array.isArray(stats?.devices) ? stats.devices : [];
  const gpu = devices.find(device =>
    /cuda|nvidia/i.test(String(device?.type || "") + " " + String(device?.name || ""))
  ) || null;
  const names = objectInfo?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
  const checkpoints = Array.isArray(names) ? names.map(String) : [];
  const modelAvailable = checkpoints.includes(config.model);
  const gpuAvailable = Boolean(gpu);
  const ready = gpuAvailable && modelAvailable;
  return {
    provider: "comfyui", configured: true, reachable: true, gpuAvailable,
    gpu: gpu ? {
      name: String(gpu.name || "NVIDIA CUDA device").slice(0, 160),
      type: String(gpu.type || "cuda").slice(0, 40),
      vramTotalBytes: Number.isFinite(Number(gpu.vram_total)) ? Number(gpu.vram_total) : null,
      vramFreeBytes: Number.isFinite(Number(gpu.vram_free)) ? Number(gpu.vram_free) : null
    } : null,
    modelAvailable, ready, workflow: config.workflow, model: config.model,
    reason: ready ? null : !gpuAvailable ? "nvidia_gpu_not_detected" : "checkpoint_not_found"
  };
}

export function imageProviderInfo() {
  const { workflow, model } = configuredComfyUIImage(process.env);
  return {
    mobile: {
      local: true,
      configured: mobileNodeInfo().configured,
      connected: mobileNodeInfo().connected,
      mode: "mobile-node",
      capabilities: ["image-text-to-image", "image-image-to-image"],
      note: "Mobile image generation is a separate optional backend; it is not required by the self-hosted GPU engine."
    },
    comfyui: {
      local: true,
      configured: Boolean(String(process.env.COMFYUI_URL || "").trim()),
      workflow,
      model,
      qualityPreset: workflow === "flux-schnell" ? "FLUX.1-schnell FP8 (4-step distilled model)" : "ComfyUI checkpoint workflow"
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
