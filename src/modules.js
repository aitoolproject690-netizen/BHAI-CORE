const ENGINE_MODULES = Object.freeze([
  {
    id: "chat",
    icon: "💬",
    name: "Chat + Streaming",
    description: "Provider router + SSE",
    permissions: ["agent:read"]
  },
  {
    id: "rag",
    icon: "🧠",
    name: "RAG + Memory",
    description: "Files, embeddings, conversations",
    permissions: ["files:read", "files:write", "agent:read"]
  },
  {
    id: "agent",
    icon: "🛠️",
    name: "Agent",
    description: "Tools, approvals, audit",
    permissions: ["agent:read", "agent:write", "jobs:read", "jobs:write"]
  },
  {
    id: "image",
    icon: "🖼️",
    name: "Image",
    description: "ComfyUI adapter",
    permissions: ["image:write"]
  },
  {
    id: "video",
    icon: "🎬",
    name: "Video",
    description: "External video adapter",
    permissions: ["video:read", "video:write"]
  },
  {
    id: "voice_vision",
    icon: "🎙️",
    name: "Voice + Vision",
    description: "Whisper/Piper + vision providers",
    permissions: ["voice:read", "voice:write", "vision:read"]
  },
  {
    id: "github_cloud",
    icon: "🐙",
    name: "GitHub + Cloud",
    description: "Repository/build/deployment tools",
    permissions: ["github:read", "github:write", "github:admin", "cloud:build"]
  },
  {
    id: "billing",
    icon: "💳",
    name: "Billing",
    description: "Plans, quota and usage",
    permissions: ["billing:read", "billing:write"]
  }
]);

const MODULE_BY_ID = new Map(ENGINE_MODULES.map(module => [module.id, module]));

export function moduleCatalog() {
  return ENGINE_MODULES.map(module => ({
    id: module.id,
    icon: module.icon,
    name: module.name,
    description: module.description,
    permissions: [...module.permissions]
  }));
}

export function normalizeModuleIds(modules) {
  if (!Array.isArray(modules)) return [];
  const result = [...new Set(modules.map(value => String(value).trim().toLowerCase()).filter(Boolean))];
  const unknown = result.filter(id => !MODULE_BY_ID.has(id));
  if (unknown.length) {
    const error = new Error("Unknown engine module: " + unknown.join(", "));
    error.code = "MODULE_INVALID";
    error.status = 400;
    error.modules = unknown;
    throw error;
  }
  return result;
}

export function expandModulePermissions(modules) {
  const ids = normalizeModuleIds(modules);
  return [...new Set(ids.flatMap(id => MODULE_BY_ID.get(id).permissions))];
}

export function modulesForScopes(scopes) {
  if (scopes === undefined || scopes === null) return ENGINE_MODULES.map(module => module.id);
  const values = new Set(Array.isArray(scopes) ? scopes.map(String) : []);
  if (values.has("*")) return ENGINE_MODULES.map(module => module.id);
  return ENGINE_MODULES
    .filter(module => module.permissions.every(permission => values.has(permission)))
    .map(module => module.id);
}

export function modulePermissions(moduleId) {
  const module = MODULE_BY_ID.get(String(moduleId || "").trim().toLowerCase());
  return module ? [...module.permissions] : [];
}

export function moduleForRequest(pathname, method = "GET") {
  const path = String(pathname || "");
  const verb = String(method || "GET").toUpperCase();

  if (
    (path === "/v1/chat/completions" || path === "/v1/chat/completions/stream") && verb === "POST"
  ) return "chat";
  if (path === "/v1/providers" || path === "/v1/models" || path === "/v1/engine/health" || path === "/v1/models/capabilities") return "chat";

  if (
    path === "/v1/embeddings" ||
    path.startsWith("/v1/files") ||
    path.startsWith("/v1/rag/") ||
    path === "/v1/memory/info" ||
    path.startsWith("/v1/conversations")
  ) return "rag";

  if (path.startsWith("/v1/agent/") || path.startsWith("/v1/jobs")) return "agent";

  if (path.startsWith("/v1/image/")) return "image";

  if (path.startsWith("/v1/video/")) return "video";

  if (path.startsWith("/v1/voice/") || path.startsWith("/v1/vision/")) return "voice_vision";

  if (path.startsWith("/v1/billing/") || path === "/v1/billing") return "billing";

  if (path.startsWith("/v1/cloud/")) return "github_cloud";

  return null;
}

export const ALL_MODULE_IDS = Object.freeze(ENGINE_MODULES.map(module => module.id));
