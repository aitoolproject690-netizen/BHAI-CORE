import test from "node:test";
import assert from "node:assert/strict";
import { startRuntime, healthCheck } from "../src/runtime.js";
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


test("runtime terminates commands that exceed the timeout", async () => {
  process.env.BHAI_RUNTIME_ENABLED = "true";
  const r = startRuntime({ command: "sleep 2", cwd: process.cwd(), timeoutMs: 1000 });
  const exit = await r.exit;
  assert.equal(exit.timedOut, true);
  assert.notEqual(exit.code, 0);
  delete process.env.BHAI_RUNTIME_ENABLED;
});


test("runtime does not inherit core secret environment variables", async () => {
  process.env.BHAI_RUNTIME_ENABLED = "true";
  process.env.BHAI_CORE_SECRET_TEST = "must-not-leak";
  const r = startRuntime({ command: "printf \"%s\" \"$BHAI_CORE_SECRET_TEST\"", cwd: process.cwd() });
  const exit = await r.exit;
  assert.equal(exit.code, 0);
  assert.equal(exit.stdout, "");
  delete process.env.BHAI_CORE_SECRET_TEST;
  delete process.env.BHAI_RUNTIME_ENABLED;
});


test("health checks reject non-local targets", async () => {
  await assert.rejects(() => healthCheck("http://example.com/health"), /local service/);
  await assert.rejects(() => healthCheck("http://127.0.0.1:9999/health", { expectedPort: 3000 }), /service port/);
});
