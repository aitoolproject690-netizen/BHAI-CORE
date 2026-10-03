import test from "node:test";
import assert from "node:assert/strict";
import { classifyError } from "../src/retry.js";

test("provider auth failures are classified separately from permanent errors", () => {
  assert.equal(classifyError(Object.assign(new Error("invalid API key"), { status: 401 })), "auth");
});

test("provider model-not-found failures are classified separately", () => {
  assert.equal(classifyError(Object.assign(new Error("model not found"), { status: 404 })), "model");
});

test("provider overload and rate-limit failures are retryable", () => {
  assert.equal(classifyError(Object.assign(new Error("overloaded"), { status: 503 })), "retryable");
  assert.equal(classifyError(Object.assign(new Error("rate limited"), { status: 429 })), "retryable");
});
