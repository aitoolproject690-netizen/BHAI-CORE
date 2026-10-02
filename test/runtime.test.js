import test from "node:test";
import assert from "node:assert/strict";
import { startRuntime } from "../src/runtime.js";
process.env.BHAI_RUNTIME_ENABLED = "true";

test("runtime starts a bounded validated command", async () => {
  const r = startRuntime({ command: "printf runtime-ok", cwd: process.cwd() });
  const exit = await r.exit;
  assert.equal(exit.code, 0);
  assert.match(exit.stdout, /runtime-ok/);
});

test("runtime rejects destructive shell patterns", () => {
  assert.throws(() => startRuntime({ command: "rm -rf /tmp/x", cwd: process.cwd() }), /Runtime command rejected/);
});


test("runtime refuses to spawn when disabled", () => {
  const previous = process.env.BHAI_RUNTIME_ENABLED;
  process.env.BHAI_RUNTIME_ENABLED = "false";
  assert.throws(() => startRuntime({ command: "printf should-not-run", cwd: process.cwd() }), /Cloud runtime is disabled/);
  process.env.BHAI_RUNTIME_ENABLED = previous;
});

test("runtime rejects shell chaining and redirection",()=>{process.env.BHAI_RUNTIME_ENABLED="true";assert.throws(()=>startRuntime({command:"node app.js && whoami",cwd:process.cwd()}),/rejected/);assert.throws(()=>startRuntime({command:"node app.js > out",cwd:process.cwd()}),/rejected/);delete process.env.BHAI_RUNTIME_ENABLED;});
