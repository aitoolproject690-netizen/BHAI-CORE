import test from "node:test";
import assert from "node:assert/strict";
import { createJob, getJob, updateJob, resetJobs } from "../src/jobs.js";

test("job lifecycle can be tracked", () => {
  resetJobs();
  const job = createJob("chat", { hello:"world" });
  assert.equal(getJob(job.id).status, "queued");
  updateJob(job.id, { status:"running" });
  assert.equal(getJob(job.id).status, "running");
});
