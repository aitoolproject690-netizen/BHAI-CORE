import test from "node:test";
import assert from "node:assert/strict";
import { cloudJobInfo } from "../src/cloudJob.js";

test("cloud job declares cleanup and bounded execution", () => {
  const info = cloudJobInfo();
  assert.equal(info.workspaceCleanup, "always");
  assert.equal(info.source, "github");
  assert.equal(info.buildRunner, "bounded");
});
