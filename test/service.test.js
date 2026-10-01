import test from "node:test";
import assert from "node:assert/strict";
process.env.BHAI_RUNTIME_ENABLED="true";
import { createService, getService, stopService, restoreServices } from "../src/service.js";
import { getStore, resetStoreForTests } from "../src/store.js";

test("service lifecycle is owner scoped", async () => {
  const s = await createService({ ownerId:"owner-1", buildId:"build-1", command:"sleep 5", cwd:process.cwd() });
  assert.equal((await getService(s.id,"owner-2")), null);
  const mine = await getService(s.id,"owner-1");
  assert.equal(mine.status,"running");
  await stopService(s.id,"owner-1");
});

test("service metadata persists without persisting a live child process", async () => {
  resetStoreForTests();
  const s = await createService({ ownerId:"owner-persist", buildId:"build-persist", command:"sleep 5", cwd:process.cwd() });
  const stopped = await stopService(s.id, "owner-persist");
  assert.equal(stopped.status, "stopped");
  const store = await getStore();
  assert.equal(store.services[s.id].ownerId, "owner-persist");
  assert.equal(store.services[s.id].pid, null);
  assert.equal(store.services[s.id].child, undefined);
  await restoreServices();
  const restored = await getService(s.id, "owner-persist");
  assert.equal(restored.pid, null);
});
