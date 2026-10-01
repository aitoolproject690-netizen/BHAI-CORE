import test from "node:test";
import assert from "node:assert/strict";
import { recordUsage, getUsage, recordProviderUsage, allProviderUsage } from "../src/usage.js";
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

test("provider usage records health metrics", async () => {
  resetStoreForTests();
  await recordProviderUsage({ provider:"gemini", success:true, latencyMs:120, retries:1 });
  await recordProviderUsage({ provider:"gemini", success:false, latencyMs:80, retries:2, error:new Error("quota") });
  const metrics = await allProviderUsage();
  assert.equal(metrics.gemini.requests, 2);
  assert.equal(metrics.gemini.successes, 1);
  assert.equal(metrics.gemini.failures, 1);
  assert.equal(metrics.gemini.retries, 3);
  assert.equal(metrics.gemini.latencyMs, 200);
  assert.equal(metrics.gemini.lastLatencyMs, 80);
  assert.equal(metrics.gemini.lastStatus, "error");
  assert.equal(metrics.gemini.lastError, "quota");
});
