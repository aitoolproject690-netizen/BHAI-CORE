import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { getStore, updateStore, saveStore, storageInfo, resetStoreForTests } from "../src/store.js";

test("store updates state", async () => {
  resetStoreForTests();
  await updateStore(s => ({ ...s, usage: { demo: { requests: 1 } } }));
  const s = await getStore();
  assert.equal(s.usage.demo.requests, 1);
});

test("store exposes backend metadata", () => {
  const info = storageInfo();
  assert.equal(info.backend, "json");
  assert.equal(info.persistent, true);
});

test("saveStore replaces state through the serialized writer", async () => {
  resetStoreForTests();
  await saveStore({ apiKeys: {}, usage: { saved: { requests: 2 } }, providerUsage: {}, jobs: {} });
  const s = await getStore();
  assert.equal(s.usage.saved.requests, 2);
});

async function runStoreProbe(filePath) {
  const script = [
    'import { getStore } from "./src/store.js";',
    'try {',
    '  const store = await getStore();',
    '  console.log(JSON.stringify({ ok: true, approvals: store.approvals }));',
    '} catch (error) {',
    '  console.log(JSON.stringify({ ok: false, code: error.code, status: error.status }));',
    '  process.exitCode = 0;',
    '}'
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
      try { resolve(JSON.parse(stdout.trim())); } catch (error) { reject(new Error(`invalid probe output: ${stdout}\n${stderr}`, { cause: error })); }
    });
  });
}

test("store rejects corrupt persistent JSON instead of resetting state", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bhai-store-"));
  const file = path.join(dir, "store.json");
  await fs.writeFile(file, "{not-json", "utf8");
  const result = await runStoreProbe(file);
  assert.deepEqual(result, { ok: false, code: "STORE_CORRUPT", status: 500 });
  await fs.rm(dir, { recursive: true, force: true });
});

test("store initializes an empty state only when the persistent file is missing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bhai-store-"));
  const file = path.join(dir, "missing.json");
  const result = await runStoreProbe(file);
  assert.equal(result.ok, true);
  assert.deepEqual(result.approvals, {});
  await fs.rm(dir, { recursive: true, force: true });
});
