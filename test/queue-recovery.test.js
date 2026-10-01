import test from "node:test";
import assert from "node:assert/strict";
import { enqueue, getQueuedJob, getStoredJob } from "../src/queue.js";
import { resetStoreForTests, updateStore } from "../src/store.js";

test("queued jobs receive leases", async () => {
  resetStoreForTests();
  const created = await enqueue("demo");
  const running = await getQueuedJob();
  assert.equal(running.id, created.id);
  assert.equal(running.status, "running");
  assert.ok(running.leaseExpiresAt);
});

test("expired running jobs are recovered", async () => {
  resetStoreForTests();
  const created = await enqueue("demo");
  await getQueuedJob();
  await updateStore(store => {
    store.jobs[created.id].leaseExpiresAt = new Date(Date.now() - 1000).toISOString();
    return store;
  });
  const recovered = await getQueuedJob();
  assert.equal(recovered.id, created.id);
  assert.equal(recovered.status, "running");
  assert.equal(recovered.attempts, 2);
  assert.ok((await getStoredJob(created.id)).recoveredAt);
});
