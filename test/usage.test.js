import test from "node:test";
import assert from "node:assert/strict";
import { recordUsage, getUsage } from "../src/usage.js";
import { budgetStatus, assertBudget } from "../src/budget.js";
import { resetStoreForTests } from "../src/store.js";

test("usage records requests and characters", async () => {
  resetStoreForTests();
  await recordUsage({ key:"test", input:10, output:20 });
  const u = await getUsage("test");
  assert.equal(u.requests, 1);
  assert.equal(u.charsIn, 10);
  assert.equal(u.charsOut, 20);
});

test("budget blocks when request limit is reached", async () => {
  resetStoreForTests();
  await recordUsage({ key:"test", input:5, output:1 });
  assert.equal((await budgetStatus("test", { maxRequests:1 })).exceeded, true);
  await assert.rejects(() => assertBudget("test", { maxRequests:1 }), /Usage budget exceeded/);
});
