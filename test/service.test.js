import test from "node:test";
import assert from "node:assert/strict";
process.env.BHAI_RUNTIME_ENABLED="true";
import { createService, getService, stopService, restoreServices } from "../src/service.js";
import { getStore, resetStoreForTests } from "../src/store.js";
import { createRoute, findRouteByHostname } from "../src/network.js";

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

test("stopping a service disables its route", async () => {
  resetStoreForTests();
  const s = await createService({ ownerId:"owner-route", buildId:"build-route", command:"sleep 5", cwd:process.cwd() });
  await createRoute({ ownerId:"owner-route", hostname:"app.route-test.com", serviceId:s.id, targetPort:s.port });
  assert.equal((await findRouteByHostname("app.route-test.com")).id, (await findRouteByHostname("app.route-test.com")).id);
  await stopService(s.id, "owner-route");
  assert.equal(await findRouteByHostname("app.route-test.com"), null);
});


test("service persistence redacts secret environment values", async () => {
  resetStoreForTests();
  const s = await createService({
    ownerId: "owner-secret",
    buildId: "build-secret",
    command: "sleep 5",
    cwd: process.cwd(),
    env: { API_TOKEN: "super-secret", PORT: "0", PUBLIC_MODE: "true" }
  });
  await stopService(s.id, "owner-secret");
  const store = await getStore();
  assert.equal(store.services[s.id].env.API_TOKEN, "[REDACTED]");
  assert.equal(store.services[s.id].env.PUBLIC_MODE, "true");
  assert.notEqual(store.services[s.id].env.API_TOKEN, "super-secret");
});
