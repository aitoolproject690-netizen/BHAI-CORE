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
