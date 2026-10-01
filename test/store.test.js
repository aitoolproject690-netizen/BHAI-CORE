import test from "node:test";
import assert from "node:assert/strict";
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
