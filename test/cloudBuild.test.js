import test from "node:test";
import assert from "node:assert/strict";
import { runBuildCommand } from "../src/buildRunner.js";
import { runCloudBuild } from "../src/cloudBuild.js";

test("build runner executes a bounded command", async () => {
  const result = await runBuildCommand("printf 'hello'", { cwd: process.cwd(), timeoutMs: 2000 });
  assert.equal(result.ok, true);
  assert.match(result.stdout, /hello/);
});

test("build runner rejects dangerous commands", async () => {
  await assert.rejects(
    () => runBuildCommand("rm -rf /"),
    error => error.code === "BUILD_COMMAND_REJECTED" && error.status === 403
  );
});

test("cloud build runs generated plan phases", async () => {
  const old = process.env.BHAI_BUILD_RUNNER_ENABLED;
  process.env.BHAI_BUILD_RUNNER_ENABLED = "true";
  try {
    const result = await runCloudBuild({
      cwd: process.cwd(),
      plan: {
        deployable: true,
        runtime: "node",
        framework: "node",
        commands: { test: "node --version" }
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.phases[0].phase, "test");
  } finally {
    if (old === undefined) delete process.env.BHAI_BUILD_RUNNER_ENABLED;
    else process.env.BHAI_BUILD_RUNNER_ENABLED = old;
  }
});
