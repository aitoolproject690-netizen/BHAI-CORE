import test from "node:test";
import assert from "node:assert/strict";
import { getStore, updateStore, resetStoreForTests } from "../src/store.js";

test("store updates state", async () => {
  resetStoreForTests();
  await updateStore(s => ({ ...s, usage: { demo: { requests: 1 } } }));
  const s = await getStore();
  assert.equal(s.usage.demo.requests, 1);
});
