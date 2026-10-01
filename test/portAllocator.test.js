import test from "node:test";
import assert from "node:assert/strict";
import { allocatePort, releasePort, portInfo } from "../src/portAllocator.js";
import { resetStoreForTests } from "../src/store.js";

test("allocator gives unique persistent ports", async () => {
  resetStoreForTests();
  const a = await allocatePort();
  const b = await allocatePort();
  assert.notEqual(a, b);
  assert.equal((await releasePort(a)), true);
  assert.equal(await allocatePort(a), a);
});

test("allocator rejects duplicate preferred port", async () => {
  resetStoreForTests();
  const port = await allocatePort(12345);
  await assert.rejects(() => allocatePort(12345), /already allocated/);
  assert.equal(await releasePort(port), true);
});

test("allocator reports configured range", () => {
  const info = portInfo();
  assert.equal(info.persistent, true);
  assert.equal(info.allocation, "store_locked");
});
