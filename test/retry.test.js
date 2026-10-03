import test from "node:test";
import assert from "node:assert/strict";
import { classifyError, withRetry } from "../src/retry.js";

test("classifies rate limits as retryable", () => {
  assert.equal(classifyError({ status: 429 }), "retryable");
});

test("classifies invalid credentials as auth errors", () => {
  assert.equal(classifyError({ status: 401 }), "auth");
});

test("classifies network failures as retryable", () => {
  assert.equal(classifyError(new TypeError("fetch failed")), "retryable");
  assert.equal(classifyError(new Error("network request failed")), "retryable");
  assert.equal(classifyError(new Error("connection refused")), "retryable");
  assert.equal(classifyError(Object.assign(new Error("temporary network failure"), { code: "ECONNRESET" })), "retryable");
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

test("retries a fetch/network failure and then succeeds", async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError("fetch failed");
    return "network recovered";
  }, { retries: 1, baseMs: 1, maxMs: 2 });

  assert.equal(result, "network recovered");
  assert.equal(attempts, 2);
});

test("invalid retry counts fall back safely without creating extra retries", async () => {
  let attempts = 0;
  await assert.rejects(
    () => withRetry(async () => {
      attempts += 1;
      throw Object.assign(new Error("temporary"), { status: 503 });
    }, { retries: -5, baseMs: 1, maxMs: 2 }),
    /temporary/
  );
  assert.equal(attempts, 1);
});

test("invalid backoff values are normalized", async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error("temporary"), { status: 503 });
    return "ok";
  }, { retries: 1, baseMs: -1, maxMs: 0 });

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});
