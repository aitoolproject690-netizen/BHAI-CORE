import { config } from "./config.js";

const VISION_PATTERNS = [
  /vision/i, /vl/i, /llava/i, /minicpm-v/i, /qwen2\.5-vl/i, /qwen2-vl/i,
  /gemma-3/i, /pixtral/i, /claude-3/i, /gpt-4o/i
];

function inferCapabilities(provider, model) {
  const name = String(model || "").toLowerCase();
  const vision = provider === "ollama"
    ? VISION_PATTERNS.some(pattern => pattern.test(name))
    : ["gemini", "anthropic"].includes(provider) || VISION_PATTERNS.some(pattern => pattern.test(name));
  return {
    chat: true,
    streaming: ["ollama", "openai", "huggingface", "gemini"].includes(provider),
    vision,
    embeddings: provider === "ollama" && /embed|nomic-embed|mxbai/i.test(name),
    tools: ["openai", "anthropic", "gemini"].includes(provider),
    local: provider === "ollama"
  };
}

async function fetchOllamaModels(url, timeoutMs = 5000) {
  const baseUrl = String(url || "http://127.0.0.1:11434").replace(/\/$/, "");
  const response = await fetch(baseUrl + "/api/tags", {
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error("Ollama model discovery failed: HTTP " + response.status);
  const data = await response.json();
  return Array.isArray(data.models) ? data.models : [];
}

export function getConfiguredModelRegistry() {
  const cfg = config();
  const models = [];
  for (const provider of Object.keys(cfg.providers)) {
    const entry = cfg.providers[provider];
    if (!entry?.key || !entry.model) continue;
    models.push({
      id: provider + ":" + entry.model,
      provider,
      model: entry.model,
      configured: true,
      source: provider === "ollama" ? "local-config" : "provider-config",
      capabilities: inferCapabilities(provider, entry.model)
    });
  }
  return models;
}

export async function getModelRegistry({ probeOllama = false } = {}) {
  const cfg = config();
  const models = getConfiguredModelRegistry();
  const ollama = cfg.providers.ollama;

  if (probeOllama && ollama?.key) {
    try {
      const discovered = await fetchOllamaModels(ollama.url);
      for (const item of discovered) {
        const model = String(item.name || item.model || "").trim();
        if (!model) continue;
        const id = "ollama:" + model;
        if (models.some(existing => existing.id === id)) continue;
        models.push({
          id,
          provider: "ollama",
          model,
          configured: true,
          source: "ollama-tags",
          size: item.size ?? null,
          modified_at: item.modified_at ?? null,
          capabilities: inferCapabilities("ollama", model)
        });
      }
    } catch (error) {
      return {
        ok: false,
        models,
        ollama: {
          available: false,
          url: ollama.url,
          error: error.message
        }
      };
    }
  }

  return {
    ok: true,
    models,
    ollama: {
      available: Boolean(ollama?.key),
      url: ollama?.url || null
    }
  };
}

export function modelCapabilities(provider, model) {
  return inferCapabilities(String(provider || "").toLowerCase(), model);
}
