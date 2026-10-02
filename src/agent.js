import crypto from "node:crypto";
import { searchRag, ragContext } from "./rag.js";
import { analyzeImage, getVisionCandidates } from "./vision.js";
import { createImageRequest, submitComfyUI } from "./image.js";
import { createSpeechRequest, transcribeWhisper, createTtsRequest, synthesizePiper, voiceProviderInfo } from "./voice.js";
import { getModelRegistry } from "./models.js";
import { enqueue, getStoredJob } from "./queue.js";
import { generate } from "./router.js";
import { config } from "./config.js";
import { authorizeTool, getToolPolicy } from "./policy.js";
import { recordAudit } from "./audit.js";
import { getApproval } from "./approval.js";
import { githubRepoList, githubRepoGet, githubFileRead, githubFileWrite, githubRepoCreate } from "./github.js";
import { createBuildPlan, runBuildPlan } from "./cloud.js";

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
  { name: "job_get", description: "Read a persistent job status.", input: ["id"] },
  { name: "github_repo_list", description: "List repositories visible to the configured GitHub integration.", input: ["owner", "pageSize", "pageOffset"] },
  { name: "github_repo_get", description: "Inspect one GitHub repository.", input: ["repository"] },
  { name: "github_file_read", description: "Read a text file from a GitHub repository.", input: ["repository", "path", "ref"] },
  { name: "github_file_write", description: "Write a text file to a GitHub repository.", input: ["repository", "path", "content", "message", "branch"] },
  { name: "github_repo_create", description: "Create a GitHub repository.", input: ["name", "description", "private"] },
  { name: "cloud_build_plan", description: "Inspect a GitHub repository and create a deterministic build/test/start plan.", input: ["repository", "branch"] },
  { name: "cloud_build_execute", description: "Execute an approved build/test plan in the configured build workspace.", input: ["plan", "cwd"] }
]);

function required(value, name) {
  if (value === undefined || value === null || value === "") throw new Error(name + " is required");
  return value;
}

export function listAgentTools() {
  return AGENT_TOOLS.map(tool => ({ ...tool, input: [...tool.input], policy: getToolPolicy(tool.name) }));
}

export async function executeAgentTool(name, input = {}, identity = {}, options = {}) {
  const tool = String(name || "").trim();
  if (!AGENT_TOOLS.some(item => item.name === tool)) throw new Error("Unknown agent tool: " + tool);
  const ownerId = required(identity.id, "authenticated identity");
  const policy = authorizeTool(tool, identity);
  if (policy.risk === "high") {
    const approval = options.approvalId ? await getApproval(options.approvalId, identity.id) : null;
    const approvalInputHash = crypto.createHash("sha256").update(JSON.stringify(input ?? {})).digest("hex");
    if (!approval || approval.tool !== tool || approval.status !== "approved" || approval.inputHash !== approvalInputHash || !approval.expiresAt || Date.parse(approval.expiresAt) <= Date.now()) {
      const error = new Error("Approved action required for tool " + tool);
      error.code = "APPROVAL_REQUIRED"; error.status = 428;
      throw error;
    }
  }
  await recordAudit({ actorId: identity.id, action: "agent.execute", tool, status: "started", requestId: options.requestId });

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
      return enqueue(input.type || "generic", { ...(input.payload || {}), ownerId });
    case "job_get":
      return getStoredJob(required(input.id, "id"), ownerId);
    case "github_repo_list":
      return githubRepoList(input);
    case "github_repo_get":
      return githubRepoGet(required(input.repository, "repository"));
    case "github_file_read":
      return githubFileRead({ repository: required(input.repository, "repository"), path: required(input.path, "path"), ref: input.ref });
    case "github_file_write":
      return githubFileWrite({ repository: required(input.repository, "repository"), path: required(input.path, "path"), content: required(input.content, "content"), message: input.message, branch: input.branch, sha: input.sha });
    case "github_repo_create":
      return githubRepoCreate({ name: required(input.name, "name"), description: input.description, private: input.private });
    case "cloud_build_execute":
      return runBuildPlan(required(input.plan, "plan"), { cwd: required(input.cwd, "cwd") });
    case "cloud_build_plan": {
      const repository = required(input.repository, "repository");
      const repo = await githubRepoGet(repository);
      const branch = input.branch || repo.defaultBranch;
      const files = [];
      for (const path of ["package.json", "requirements.txt", "pyproject.toml", "go.mod", "Cargo.toml", "Dockerfile"]) {
        try { files.push(await githubFileRead({ repository, path, ref: branch })); } catch {}
      }
      return createBuildPlan({ repository, branch, repo, files });
    }
  }
}
