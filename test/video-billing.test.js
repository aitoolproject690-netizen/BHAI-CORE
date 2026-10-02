import test from "node:test";
import assert from "node:assert/strict";
import { createVideoRequest, planVideo } from "../src/video.js";
import { billingPlans } from "../src/billing.js";

test("video engine validates and builds a timeline", () => {
  const request = createVideoRequest({
    scenes: [{ prompt: "opening", duration: 2 }, { prompt: "ending", duration: 3 }]
  });
  const plan = planVideo(request);
  assert.equal(request.durationSeconds, 5);
  assert.deepEqual(plan.timeline.map(x => [x.start, x.end]), [[0, 2], [2, 5]]);
});

test("video engine rejects excessive duration", () => {
  assert.throws(() => createVideoRequest({ scenes: [{ prompt: "x", duration: 601 }] }), /between 0 and 60/);
});

test("billing plans expose stable quotas", () => {
  const plans = billingPlans();
  assert.equal(plans.free.id, "free");
  assert.ok(plans.pro.monthlyRequests > plans.free.monthlyRequests);
});

import { setBillingPlan } from "../src/billing.js";

test("billing rejects unknown plans", async () => {
  await assert.rejects(() => setBillingPlan("test-owner", "not-a-plan"), { code: "BILLING_PLAN_INVALID", status: 400 });
});

import { createSpeechRequest, createTtsRequest } from "../src/voice.js";
import { normalizeVisionRequest } from "../src/vision.js";

test("voice request validators enforce required input and limits", () => {
  assert.throws(() => createSpeechRequest({}), /audio is required/);
  assert.throws(() => createTtsRequest({ text: "" }), /text is required/);
});

test("vision request validator accepts supported image data", () => {
  const result = normalizeVisionRequest({ prompt: "describe", image: "aGVsbG8=" });
  assert.equal(result.image.mimeType, "image/jpeg");
});

import { recordBillingUsage } from "../src/billing.js";

test("billing rejects negative or non-finite usage deltas", async () => {
  await assert.rejects(() => recordBillingUsage("billing-test", { requests: -1 }), { code: "BILLING_USAGE_INVALID", status: 400 });
  await assert.rejects(() => recordBillingUsage("billing-test", { charsIn: Number.NaN }), { code: "BILLING_USAGE_INVALID", status: 400 });
});

import { consumeBillingQuota, setBillingPlan } from "../src/billing.js";

test("billing quota consumption is atomic under concurrent requests", async () => {
  resetStoreForTests();
  await setBillingPlan("race-user", "free");
  await consumeBillingQuota("race-user", { requests: 99 });
  const results = await Promise.allSettled([
    consumeBillingQuota("race-user", { requests: 1 }),
    consumeBillingQuota("race-user", { requests: 1 })
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected" && result.reason?.code === "BILLING_QUOTA_EXCEEDED").length, 1);
});
