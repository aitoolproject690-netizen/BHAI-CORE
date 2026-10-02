import test from "node:test";
import assert from "node:assert/strict";
import { enqueue, getQueuedJob, finishJob, getStoredJob } from "../src/queue.js";
import { resetStoreForTests } from "../src/store.js";

test("persistent queue tracks a job lifecycle", async () => {
  resetStoreForTests();
  const created = await enqueue("demo", { value: 1 });
  assert.equal(created.status, "queued");

  const running = await getQueuedJob();
  assert.equal(running.id, created.id);
  assert.equal(running.status, "running");

  const done = await finishJob(created.id, { ok: true });
  assert.equal(done.status, "succeeded");

  const stored = await getStoredJob(created.id);
  assert.equal(stored.status, "succeeded");
});


test("stored jobs are hidden from a different owner", async () => {
  resetStoreForTests();
  const created = await enqueue("demo", { ownerId: "owner-a", value: 1 });

  assert.ok(await getStoredJob(created.id, "owner-a"));
  assert.equal(await getStoredJob(created.id, "owner-b"), null);
});
