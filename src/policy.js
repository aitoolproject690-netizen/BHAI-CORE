const TOOL_POLICIES = Object.freeze({
  chat: { risk: "low", permissions: ["agent:read"] },
  rag_search: { risk: "low", permissions: ["files:read", "agent:read"] },
  rag_context: { risk: "low", permissions: ["files:read", "agent:read"] },
  vision_analyze: { risk: "medium", permissions: ["vision:read", "agent:read"] },
  image_generate: { risk: "medium", permissions: ["image:write", "agent:write"] },
  voice_transcribe: { risk: "medium", permissions: ["voice:read", "agent:read"] },
  voice_synthesize: { risk: "medium", permissions: ["voice:write", "agent:write"] },
  models: { risk: "low", permissions: ["models:read", "agent:read"] },
  job_create: { risk: "medium", permissions: ["jobs:write", "agent:write"] },
  job_get: { risk: "low", permissions: ["jobs:read", "agent:read"] },
  github_repo_list: { risk: "low", permissions: ["github:read", "agent:read"] },
  github_repo_get: { risk: "low", permissions: ["github:read", "agent:read"] },
  github_file_read: { risk: "low", permissions: ["github:read", "agent:read"] },
  github_file_write: { risk: "high", permissions: ["github:write", "agent:write"] },
  github_repo_create: { risk: "high", permissions: ["github:admin", "agent:write"] },
  cloud_build_plan: { risk: "low", permissions: ["github:read", "agent:read"] },
  cloud_build_execute: { risk: "high", permissions: ["cloud:build", "agent:write"] }
});

export const DEFAULT_PERMISSIONS = Object.freeze([
  "agent:read", "agent:write", "files:read", "files:write",
  "vision:read", "image:write", "voice:read", "voice:write",
  "models:read", "jobs:read", "jobs:write", "github:read"
]);

export function getToolPolicy(name) {
  return TOOL_POLICIES[name] || null;
}

export function listToolPolicies() {
  return Object.entries(TOOL_POLICIES).map(([name, policy]) => ({
    name, risk: policy.risk, permissions: [...policy.permissions]
  }));
}

export function hasPermission(identity, permission) {
  const scopes = Array.isArray(identity?.scopes) ? identity.scopes : DEFAULT_PERMISSIONS;
  return scopes.includes("*") || scopes.includes(permission);
}

export function authorizeTool(name, identity) {
  const policy = getToolPolicy(name);
  if (!policy) throw new Error("No policy defined for agent tool: " + name);
  const missing = policy.permissions.filter(permission => !hasPermission(identity, permission));
  if (missing.length) {
    const error = new Error("Permission denied for tool " + name + ": " + missing.join(", "));
    error.code = "PERMISSION_DENIED";
    error.status = 403;
    error.tool = name;
    error.missingPermissions = missing;
    throw error;
  }
  return policy;
}
