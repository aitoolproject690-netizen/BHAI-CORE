import test from "node:test";
import assert from "node:assert/strict";
import { checkoutGithubRepository } from "../src/source.js";

test("source checkout validates repository before git", async () => {
  await assert.rejects(
    () => checkoutGithubRepository({ workspacePath: "/tmp/x", repository: "../bad" }),
    e => e.code === "INVALID_REPOSITORY"
  );
});

test("source checkout rejects unsafe branch names", async () => {
  await assert.rejects(
    () => checkoutGithubRepository({ workspacePath: "/tmp/x", repository: "a/b", branch: "../main" }),
    e => e.code === "INVALID_BRANCH"
  );
});
