import test from "node:test";
import assert from "node:assert/strict";
import { startRuntime, stopRuntime } from "../src/runtime.js";

test("runtime starts a bounded validated command", async () => {
  const r = startRuntime({ command: "printf runtime-ok", cwd: process.cwd() });
  const exit = await r.exit;
  assert.equal(exit.code, 0);
  assert.match(exit.stdout, /runtime-ok/);
});

test("runtime rejects destructive shell patterns", () => {
  assert.throws(() => startRuntime({ command: "rm -rf /tmp/x", cwd: process.cwd() }), /Runtime command rejected/);
});
