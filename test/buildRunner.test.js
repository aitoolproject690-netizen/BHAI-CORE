import test from "node:test";
import assert from "node:assert/strict";
import { runBuildCommand } from "../src/buildRunner.js";

test("build runner executes a bounded command", async () => {
  const result = await runBuildCommand("printf 'hello'", { timeoutMs: 5000 });
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "hello");
});

test("build runner rejects obviously destructive commands", async () => {
  await assert.rejects(() => runBuildCommand("rm -rf /"), /Command rejected/);
});


test("build runner does not inherit core secret environment variables", async () => {
  process.env.BHAI_CORE_SECRET_TEST = "must-not-leak";
  const result = await runBuildCommand("printf \"%s\" \"$BHAI_CORE_SECRET_TEST\"", { timeoutMs: 5000 });
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "");
  delete process.env.BHAI_CORE_SECRET_TEST;
});
