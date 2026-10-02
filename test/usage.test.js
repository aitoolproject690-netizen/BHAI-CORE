import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

async function runUsageProbe(filePath) {
  const script = [
    'import { recordUsage, allUsage, getUsage } from "./src/usage.js";',
    'await recordUsage({ key: "bhai_super_secret_test_key", failed: true });',
    'const usage = await allUsage();',
    'const direct = await getUsage("bhai_super_secret_test_key");',
    'console.log(JSON.stringify({ usage, direct }));'
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: path.resolve("."),
      env: { ...process.env, BHAI_STORE_FILE: filePath }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) return reject(new Error(stderr || `probe exited with ${code}`));
      try { resolve(JSON.parse(stdout.trim())); }
      catch (error) { reject(new Error(`invalid probe output: ${stdout}\n${stderr}`, { cause: error })); }
    });
  });
}

test("usage telemetry never persists a raw BHAI API key", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bhai-usage-"));
  const file = path.join(dir, "store.json");
  const result = await runUsageProbe(file);
  assert.deepEqual(result.direct, { requests: 1, failures: 1, charsIn: 0, charsOut: 0 });
  assert.equal(Object.keys(result.usage).length, 1);
  assert.ok(Object.keys(result.usage)[0].startsWith("key_"));
  assert.ok(!Object.prototype.hasOwnProperty.call(result.usage, "bhai_super_secret_test_key"));
  const persisted = await fs.readFile(file, "utf8");
  assert.ok(!persisted.includes("bhai_super_secret_test_key"));
  await fs.rm(dir, { recursive: true, force: true });
});
