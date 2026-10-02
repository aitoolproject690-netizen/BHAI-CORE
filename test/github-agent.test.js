import test from "node:test";
import assert from "node:assert/strict";
import { getToolPolicy, authorizeTool } from "../src/policy.js";
import { listAgentTools, executeAgentTool } from "../src/agent.js";

test("GitHub tools are classified by privilege", () => {
  assert.equal(getToolPolicy("github_repo_list").risk, "low");
  assert.equal(getToolPolicy("github_file_write").risk, "high");
  assert.equal(getToolPolicy("github_repo_create").risk, "high");
});

test("GitHub read requires github:read", () => {
  assert.doesNotThrow(() => authorizeTool("github_repo_list", { id: "u1", scopes: ["github:read"] }));
  assert.throws(() => authorizeTool("github_repo_list", { id: "u1", scopes: ["agent:read"] }), /Permission denied/);
});

test("GitHub write requires explicit write scope", () => {
  assert.throws(() => authorizeTool("github_file_write", { id: "u1", scopes: ["github:read", "agent:write"] }), /Permission denied/);
  assert.doesNotThrow(() => authorizeTool("github_file_write", { id: "u1", scopes: ["github:write", "agent:write"] }));
});

test("GitHub tools fail closed when the connector is not configured", async () => {
  assert.ok(listAgentTools().some(item => item.name === "github_file_read"));
  const previousToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  try {
    let caught;
    try {
      await executeAgentTool(
        "github_file_read",
        { repository: "owner/repo", path: "README.md" },
        { id: "u1", scopes: ["github:read", "agent:read"] }
      );
    } catch (error) {
      caught = error;
    }
    assert.ok(caught);
    assert.equal(caught.code, "GITHUB_NOT_CONFIGURED");
    assert.equal(caught.status, 503);
  } finally {
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
  }
});
