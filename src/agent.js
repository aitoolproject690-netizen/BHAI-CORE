import { searchRag, ragContext } from "./rag.js";
import { analyzeImage, getVisionCandidates } from "./vision.js";
import { createImageRequest, submitComfyUI } from "./image.js";
import { createSpeechRequest, transcribeWhisper, createTtsRequest, synthesizePiper, voiceProviderInfo } from "./voice.js";
import { getModelRegistry } from "./models.js";
import { enqueue, getStoredJob } from "./queue.js";
import { generate } from "./router.js";
import { config } from "./config.js";
import { authorizeTool, getToolPolicy } from "./policy.js";

export const AGENT_TOOLS = Object.freeze([
  { name: "chat", description: "Generate text with configured AI providers.", input: ["messages", "provider", "temperature", "maxAttempts"] },
  { name: "rag_search", description: "Search the authenticated user's files.", input: ["query", "limit", "mode"] },
  { name: "rag_context", description: "Build grounded context from the authenticated user's files.", input: ["query", "limit", "mode"] },
  { name: "vision_analyze", description: "Analyze an image with a configured vision model.", input: ["image", "prompt", "provider", "model"] },
  { name: "image_generate", description: "Submit an image generation job to local ComfyUI.", input: ["prompt", "provider", "model", "seed", "workflow"] },
  { name: "voice_transcribe", description: "Transcribe base64 audio through local Whisper.", input: ["audio", "mimeType", "language"] },
  { name: "voice_synthesize", description: "Synthesize speech through local Piper.", input: ["text", "voice", "language"] },
  { name: "models", description: "Inspect configured and locally discovered models.", input: ["probe"] },
  { name: "job_create", description: "Create a persistent asynchronous job.", input: ["type", "payload"] },
  { name: "job_get", description: "Read a persistent job status.", input: ["id"] }
]);

function required(value, name) {
  if (value === undefined || value === null || value === "") throw new Error(name + " is required");
  return value;
}

export function listAgentTools() {
  return AGENT_TOOLS.map(tool => ({ ...tool, input: [...tool.input], policy: getToolPolicy(tool.name) }));
}

export async function executeAgentTool(name, input = {}, identity = {}) {
  const tool = String(name || "").trim();
  if (!AGENT_TOOLS.some(item => item.name === tool)) throw new Error("Unknown agent tool: " + tool);
  const ownerId = required(identity.id, "authenticated identity");
  authorizeTool(tool, identity);

  switch (tool) {
    case "chat":
      return generate({
        messages: required(input.messages, "messages"),
        provider: input.provider,
        temperature: input.temperature,
        maxAttempts: input.maxAttempts
      });
    case "rag_search":
      return { results: await searchRag(ownerId, required(input.query, "query"), input.limit, { mode: input.mode || "hybrid" }) };
    case "rag_context":
      return ragContext(ownerId, required(input.query, "query"), input.limit, { mode: input.mode || "hybrid" });
    case "vision_analyze": {
      const candidates = getVisionCandidates();
      const selected = input.provider
        ? candidates.find(item => item.provider === String(input.provider).toLowerCase())
        : candidates[0];
      if (!selected) throw new Error("No configured vision-capable model");
      const cfg = config().providers[selected.provider];
      return analyzeImage({
        provider: selected.provider,
        model: input.model || selected.model,
        key: cfg.key,
        url: cfg.url,
        prompt: input.prompt,
        image: input.image
      });
    }
    case "image_generate": {
      const request = createImageRequest(input);
      if (request.provider !== "comfyui") throw new Error("Unsupported image provider");
      return { ...request, ...(await submitComfyUI({ url: process.env.COMFYUI_URL, request, workflow: input.workflow })), status: "submitted" };
    }
    case "voice_transcribe": {
      if (process.env.WHISPER_ENABLED !== "true") throw new Error("Local Whisper is not configured");
      const request = createSpeechRequest(input);
      return { ...request, audio: undefined, ...(await transcribeWhisper({ ...request, url: process.env.WHISPER_URL })) };
    }
    case "voice_synthesize": {
      if (process.env.PIPER_ENABLED !== "true") throw new Error("Local Piper is not configured");
      const request = createTtsRequest(input);
      return { ...request, ...(await synthesizePiper({ ...request, url: process.env.PIPER_URL })) };
    }
    case "models":
      return getModelRegistry({ probeOllama: Boolean(input.probe) });
    case "job_create":
      return enqueue(input.type || "generic", input.payload || {});
    case "job_get":
      return getStoredJob(required(input.id, "id"));
  }
}
