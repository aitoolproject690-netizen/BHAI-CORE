import crypto from "node:crypto";
import { requestMobileNode } from "./mobileNode.js";
import { getStore, updateStore } from "./store.js";

const MAX_SCENES = 120;
const MAX_TOTAL_SECONDS = 600;
const MAX_PROMPT_CHARS = 4000;

function text(value, fallback = "") { return String(value ?? fallback).trim(); }
function cleanUrl(url) { return text(url).replace(/\/$/, ""); }

function normalizeScene(scene, index) {
  if (!scene || typeof scene !== "object") throw new Error("Each scene must be an object");
  const duration = Number(scene.duration ?? 4);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60) throw new Error("Scene duration must be between 0 and 60 seconds");
  const prompt = text(scene.prompt);
  if (prompt.length > MAX_PROMPT_CHARS) throw new Error("Scene prompt is too long");
  const source = text(scene.source || scene.image || scene.video || "");
  if (!prompt && !source) throw new Error("Scene requires prompt or source");
  return {
    index,
    duration,
    prompt: prompt || null,
    source: source || null,
    transition: text(scene.transition || "cut").toLowerCase()
  };
}

export function createVideoRequest({ scenes, provider = "http", model = null, width = 1920, height = 1080, fps = 24, format = "mp4" }) {
  if (!Array.isArray(scenes) || scenes.length === 0) throw new Error("scenes must be a non-empty array");
  if (scenes.length > MAX_SCENES) throw new Error("Too many scenes");
  const normalized = scenes.map(normalizeScene);
  const totalSeconds = normalized.reduce((sum, scene) => sum + scene.duration, 0);
  if (totalSeconds > MAX_TOTAL_SECONDS) throw new Error("Video duration exceeds the maximum");
  const w = Number(width), h = Number(height), rate = Number(fps);
  if (![w, h, rate].every(Number.isInteger) || w < 256 || h < 256 || w > 4096 || h > 4096 || rate < 1 || rate > 120)
    throw new Error("Invalid video dimensions or fps");
  if (!/^(mp4|webm)$/i.test(format)) throw new Error("Unsupported video format");
  return {
    id: "vid_" + crypto.randomUUID(),
    provider: text(provider, "http").toLowerCase(),
    model: model ? text(model) : null,
    width: w, height: h, fps: rate, format: format.toLowerCase(),
    scenes: normalized,
    durationSeconds: Number(totalSeconds.toFixed(3))
  };
}

export function planVideo(request) {
  let cursor = 0;
  return {
    id: request.id,
    provider: request.provider,
    model: request.model,
    output: { width: request.width, height: request.height, fps: request.fps, format: request.format },
    durationSeconds: request.durationSeconds,
    timeline: request.scenes.map(scene => {
      const item = { ...scene, start: Number(cursor.toFixed(3)), end: Number((cursor + scene.duration).toFixed(3)) };
      cursor += scene.duration;
      return item;
    })
  };
}

export async function submitMobileVideo({ request }) {
  const response = await requestMobileNode({
    path: "/v1/video/generate",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(planVideo(request))
  });
  const raw = await response.text();
  let data; try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!response.ok) throw Object.assign(new Error(data?.error || data?.message || "Mobile video engine failed"), { status: response.status });
  const jobId = data.jobId || data.id;
  if (!jobId) throw new Error("Mobile video engine returned no job id");
  return { provider: "mobile", jobId: String(jobId), output: data.output || null, status: data.status || "submitted" };
}

export async function getMobileVideoJob({ jobId }) {
  const response = await requestMobileNode({ path: "/v1/video/jobs/" + encodeURIComponent(String(jobId)), method: "GET", headers: {} });
  const raw = await response.text();
  let data; try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!response.ok) throw Object.assign(new Error(data?.error || data?.message || "Mobile video job lookup failed"), { status: response.status });
  return { provider: "mobile", jobId: String(jobId), job: data };
}

export async function submitVideoHttp({ url, apiKey, request }) {
  const endpoint = cleanUrl(url);
  if (!endpoint) throw Object.assign(new Error("Video API is not configured"), { code: "VIDEO_NOT_CONFIGURED", status: 503 });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...(apiKey ? { authorization: "Bearer " + apiKey } : {}) },
    body: JSON.stringify(planVideo(request)),
    signal: AbortSignal.timeout(30000)
  });
  const raw = await response.text();
  let data; try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!response.ok) throw Object.assign(new Error(data?.error || data?.message || "Video provider request failed"), { status: response.status });
  return { provider: "http", jobId: data.jobId || data.id || null, status: data.status || "submitted", output: data.output || null };
}

export function videoProviderInfo() {
  return {
    mobile: { configured: true, local: true, mode: "mobile-node", capabilities: ["video-image-to-video","video-text-to-video"] },
    http: {
      configured: Boolean(process.env.VIDEO_API_URL),
      url: cleanUrl(process.env.VIDEO_API_URL || ""),
      mode: "external-adapter"
    }
  };
}


export async function recordVideoJobOwnership({ jobId, ownerId, requestId = null, provider = "mobile" }) {
  const id = String(jobId || "").trim();
  if (!id || !/^[A-Za-z0-9._:-]{1,160}$/.test(id)) throw new Error("Invalid video job id");
  if (!ownerId) throw new Error("ownerId is required");
  await updateStore(store => {
    store.videoJobs ??= {};
    store.videoJobs[id] = { jobId:id, ownerId:String(ownerId), requestId:requestId || null, provider:String(provider || "mobile").toLowerCase(), createdAt:new Date().toISOString() };
    return store;
  });
  return { jobId:id, ownerId:String(ownerId) };
}

export async function getVideoJobOwnership(jobId, ownerId) {
  const id=String(jobId || "").trim();
  const store=await getStore();
  const job=store.videoJobs?.[id];
  if(!job || job.ownerId!==ownerId) return null;
  return {...job};
}
