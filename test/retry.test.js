import test from "node:test";
import assert from "node:assert/strict";
import { classifyError, withRetry } from "../src/retry.js";

test("classifies rate limits as retryable", () => {
  assert.equal(classifyError({ status: 429 }), "retryable");
});

test("classifies invalid credentials as auth errors", () => {
  assert.equal(classifyError({ status: 401 }), "auth");
});

test("retries transient failures and then succeeds", async () => {
  let attempts = 0;
  let retriesSeen = 0;
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error("temporary"), { status: 503 });
    return "ok";
  }, {
    retries: 2,
    baseMs: 1,
    maxMs: 2,
    onRetry: ({ attempt }) => { retriesSeen = attempt; }
  });

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.equal(retriesSeen, 2);
});
