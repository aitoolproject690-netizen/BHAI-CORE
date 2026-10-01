import test from "node:test";
import assert from "node:assert/strict";
import { authorizeTool, getToolPolicy, hasPermission, listToolPolicies } from "../src/policy.js";

test("every agent tool has a policy", () => {
  const names = listToolPolicies().map(item => item.name);
  for (const name of ["chat","rag_search","rag_context","vision_analyze","image_generate","voice_transcribe","voice_synthesize","models","job_create","job_get"])
    assert.ok(names.includes(name));
});

test("read permissions can be restricted", () => {
  assert.doesNotThrow(() => authorizeTool("models", { id: "u1", scopes: ["models:read"] }));
  assert.throws(() => authorizeTool("image_generate", { id: "u1", scopes: ["models:read"] }), error => error.code === "PERMISSION_DENIED");
});

test("wildcard permission allows the tool", () => {
  assert.equal(hasPermission({ scopes: ["*"] }, "github:write"), true);
});

test("unknown tools have no implicit permission", () => {
  assert.throws(() => authorizeTool("future_secret_tool", { id: "u1", scopes: ["*"] }), /No policy defined/);
});

test("policy metadata is safe", () => {
  assert.ok(JSON.stringify(listToolPolicies()).toLowerCase().includes("permissions"));
  assert.doesNotMatch(JSON.stringify(listToolPolicies()), /api[_-]?key|secret|token/i);
});
