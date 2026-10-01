import { config } from "./config.js";
import { providerAdapters } from "./providers.js";
import { modelCapabilities } from "./models.js";

const MAX_IMAGE_BYTES = Number(process.env.BHAI_MAX_IMAGE_BYTES || 8_000_000);

function cleanBase64(value) {
  const raw = String(value || "");
  const match = raw.match(/^data:([^;]+);base64,(.+)$/s);
  if (match) return { mimeType: match[1], data: match[2] };
  return { mimeType: "image/jpeg", data: raw };
}

function estimateBytes(base64) { return Math.floor(String(base64).length * 0.75); }

function normalizeImage(image) {
  const source = cleanBase64(image?.data || image?.base64 || image);
  if (!source.data) throw new Error("image base64 data is required");
  if (!/^image\/(jpeg|jpg|png|webp|gif)$/.test(source.mimeType)) throw new Error("Unsupported image type");
  if (estimateBytes(source.data) > MAX_IMAGE_BYTES) throw new Error("Image is too large");
  return source;
}

function visionMessages(prompt, image) {
  return [{ role: "user", content: [
    { type: "text", text: String(prompt || "Describe this image accurately.") },
    { type: "image", mimeType: image.mimeType, data: image.data }
  ] }];
}

function providerVisionPayload(provider, messages) {
  const item = messages[0];
  const text = item.content.find(x => x.type === "text")?.text || "";
  const image = item.content.find(x => x.type === "image");
  if (!image) throw new Error("Image content is required");
  if (provider === "ollama") return [{ role: "user", content: text, images: [image.data] }];
  if (provider === "openai") return [{ role: "user", content: [
    { type: "text", text },
    { type: "image_url", image_url: { url: "data:" + image.mimeType + ";base64," + image.data } }
  ] }];
  if (provider === "gemini") return [{ role: "user", parts: [
    { text }, { inlineData: { mimeType: image.mimeType, data: image.data } }
  ] }];
  if (provider === "anthropic") return [{ role: "user", content: [
    { type: "text", text },
    { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } }
  ] }];
  throw new Error("Vision adapter is not implemented for provider: " + provider);
}

function assertVisionProvider(provider, model) {
  if (!modelCapabilities(provider, model).vision) throw new Error("Selected model is not marked as vision-capable");
}

export function normalizeVisionRequest({ prompt, image }) {
  return { prompt: String(prompt || "Describe this image accurately."), image: normalizeImage(image) };
}

export async function analyzeImage({ provider, model, key, url, prompt, image }) {
  const normalized = normalizeVisionRequest({ prompt, image });
  const selected = String(provider || "").toLowerCase();
  if (!selected) throw new Error("provider is required");
  assertVisionProvider(selected, model);
  const messages = visionMessages(normalized.prompt, normalized.image);
  if (selected === "ollama") {
    const result = await providerAdapters.ollama({ url, model, messages, temperature: 0.2 });
    return { text: result.text, provider: selected, model };
  }
  if (selected === "openai") {
    const result = await providerAdapters.openai({ key, model, messages: providerVisionPayload(selected, messages), temperature: 0.2 });
    return { text: result.text, provider: selected, model };
  }
  if (selected === "gemini") {
    const result = await providerAdapters.gemini({ key, model, messages: providerVisionPayload(selected, messages), temperature: 0.2 });
    return { text: result.text, provider: selected, model };
  }
  if (selected === "anthropic") {
    const result = await providerAdapters.anthropic({ key, model, messages: providerVisionPayload(selected, messages), temperature: 0.2 });
    return { text: result.text, provider: selected, model };
  }
  throw new Error("Vision provider is not supported: " + selected);
}

export function getVisionCandidates() {
  const cfg = config();
  return cfg.providerOrder.filter(name => {
    const entry = cfg.providers[name];
    return Boolean(entry?.key && providerAdapters[name] && modelCapabilities(name, entry.model).vision);
  }).map(name => ({ provider: name, model: cfg.providers[name].model }));
}