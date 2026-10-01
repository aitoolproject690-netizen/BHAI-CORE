import test from "node:test";
import assert from "node:assert/strict";
import { enqueue } from "../src/queue.js";
import { appendBuildLog, setBuildPhase, addBuildArtifact, getBuildDetails } from "../src/buildLogs.js";
import { resetStoreForTests } from "../src/store.js";

test("build logs, phase and artifacts persist and remain owner scoped", async () => {
  resetStoreForTests();
  const job = await enqueue("cloud_build", { x: 1 });
  await setBuildPhase(job.id, "testing");
  await appendBuildLog(job.id, { phase: "testing", message: "tests started" });
  await addBuildArtifact(job.id, { name: "dist.zip", path: "dist.zip", size: 123 });
  const details = await getBuildDetails(job.id, "owner-1");
  assert.equal(details, null);
  const stored = await getBuildDetails(job.id);
  assert.equal(stored.buildPhase, "testing");
  assert.equal(stored.buildLogs.length, 1);
  assert.equal(stored.artifacts[0].name, "dist.zip");
});
