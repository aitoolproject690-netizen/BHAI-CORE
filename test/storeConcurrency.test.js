import test from "node:test";
import assert from "node:assert/strict";
import { updateStore, getStore, resetStoreForTests } from "../src/store.js";

test("store serializes concurrent updates without losing state", async () => {
  resetStoreForTests();
  await Promise.all(Array.from({ length: 25 }, (_, i) =>
    updateStore(store => {
      store.usage[i] = { requests: 1 };
      return store;
    })
  ));
  const store = await getStore();
  assert.equal(Object.keys(store.usage).length, 25);
});
