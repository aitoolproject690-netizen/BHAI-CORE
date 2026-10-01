import test from "node:test";
import assert from "node:assert/strict";
import { breakerState, canAttempt, recordFailure, recordSuccess, resetBreakers } from "../src/circuitBreaker.js";

test("breaker opens after repeated failures", () => {
  resetBreakers();
  recordFailure("demo", 2);
  assert.equal(breakerState("demo").state, "closed");
  recordFailure("demo", 2);
  assert.equal(breakerState("demo").state, "open");
  assert.equal(canAttempt("demo", 60000), false);
});

test("success closes a breaker", () => {
  resetBreakers();
  recordFailure("demo", 1);
  assert.equal(breakerState("demo").state, "open");
  recordSuccess("demo");
  assert.equal(breakerState("demo").state, "closed");
});
