import test from "node:test";
import assert from "node:assert/strict";
import { listAgentTools } from "../src/agent.js";

test("agent exposes core tools", () => {
  const names = listAgentTools().map(x => x.name);
  assert.deepEqual(names, ["chat","rag_search","rag_context","vision_analyze","image_generate","voice_transcribe","voice_synthesize","models","job_create","job_get","github_repo_list","github_repo_get","github_file_read","github_file_write","github_repo_create","cloud_build_plan","cloud_build_execute"]);
});

test("agent tool metadata is safe to expose", () => {
  const tools = listAgentTools();
  assert.ok(tools.every(tool => !JSON.stringify(tool).match(/api[_-]?key|secret|token/i)));
});