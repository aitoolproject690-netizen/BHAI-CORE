import test from "node:test";
import assert from "node:assert/strict";
import { githubInfo, githubRepoGet } from "../src/github.js";

test("GitHub info never exposes token value", () => {
  const old = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "secret-token";
  const info = githubInfo();
  assert.equal(info.enabled, true);
  assert.equal(info.tokenConfigured, true);
  assert.equal("token" in info, false);
  if (old === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = old;
});

test("GitHub repository validation happens before network call", async () => {
  await assert.rejects(() => githubRepoGet("bad-repository"), /repository must be owner\/name/);
});
