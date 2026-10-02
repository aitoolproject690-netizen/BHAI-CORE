import crypto from "node:crypto";

const MAX_PROMPT_CHARS = Number(process.env.BHAI_MAX_IMAGE_PROMPT_CHARS || 4000);

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
    comfyui: {
      local: true,
      url: cleanUrl(process.env.COMFYUI_URL),
      configured: Boolean(process.env.COMFYUI_URL || process.env.COMFYUI_ENABLED === "true")
    }
  };
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
