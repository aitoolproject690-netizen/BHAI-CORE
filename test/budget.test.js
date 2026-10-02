import test from "node:test";
import assert from "node:assert/strict";
import { budgetStatus } from "../src/budget.js";

test("budgetStatus treats invalid limits as disabled", async () => {
  const previous = process.env.BHAI_STORE_FILE;
  const path = `/tmp/bhai-budget-test-${process.pid}-${Date.now()}.json`;
  process.env.BHAI_STORE_FILE = path;
  try {
    const result = await budgetStatus("missing", {
      maxRequests: -5,
      maxInputChars: "invalid"
    });
    assert.equal(result.limits.maxRequests, 0);
    assert.equal(result.limits.maxInputChars, 0);
    assert.equal(result.exceeded, false);
  } finally {
    if (previous === undefined) delete process.env.BHAI_STORE_FILE;
    else process.env.BHAI_STORE_FILE = previous;
  }
});

test("budgetStatus preserves positive integer limits", async () => {
  const previous = process.env.BHAI_STORE_FILE;
  const path = `/tmp/bhai-budget-test-${process.pid}-${Date.now()}-2.json`;
  process.env.BHAI_STORE_FILE = path;
  try {
    const result = await budgetStatus("missing", {
      maxRequests: 10,
      maxInputChars: 1000
    });
    assert.deepEqual(result.limits, { maxRequests: 10, maxInputChars: 1000 });
  } finally {
    if (previous === undefined) delete process.env.BHAI_STORE_FILE;
    else process.env.BHAI_STORE_FILE = previous;
  }
});
