import test from "node:test";
import assert from "node:assert/strict";
import { enqueue } from "../src/queue.js";
import { processOne } from "../src/worker.js";
import { resetStoreForTests } from "../src/store.js";

test("worker processes one queued job", async () => {
  resetStoreForTests();
  const job = await enqueue("demo", { n: 7 });

  const result = await processOne(async current => ({
    jobId: current.id,
    value: current.payload.n * 2
  }));

  assert.equal(result.id, job.id);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.result, { jobId: job.id, value: 14 });
});
