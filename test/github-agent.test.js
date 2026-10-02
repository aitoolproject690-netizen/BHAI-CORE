import test from "node:test";
import assert from "node:assert/strict";
import { getToolPolicy, authorizeTool } from "../src/policy.js";
import { listAgentTools } from "../src/agent.js";
import { githubFileRead, githubInfo } from "../src/github.js";

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

test("GitHub connector fails closed when not configured", async () => {
  assert.equal(githubInfo().enabled, false);
  const previousToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  try {
    await assert.rejects(
      githubFileRead({ repository: "owner/repo", path: "README.md" }),
      error => {
        assert.equal(error.code, "GITHUB_NOT_CONFIGURED");
        assert.equal(error.status, 503);
        return true;
      }
    );
  } finally {
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
  }
});
