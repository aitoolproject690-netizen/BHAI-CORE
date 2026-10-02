import test from "node:test";
import assert from "node:assert/strict";
process.env.BHAI_RUNTIME_ENABLED="true";
import { createService, getService, stopService, restoreServices, monitorService } from "../src/service.js";
import { getStore, resetStoreForTests } from "../src/store.js";
import { createRoute, findRouteByHostname, setRouteStatus } from "../src/network.js";

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

test("crashed service keeps its allocated port for restart", async () => {
  resetStoreForTests();
  const s = await createService({
    ownerId: "owner-restart-port",
    buildId: "build-restart-port",
    command: "false",
    cwd: process.cwd()
  });
  const port = s.port;
  await new Promise(r => setTimeout(r, 500));
  const store = await getStore();
  assert.equal(store.services[s.id].port, port);
  assert.equal(store.services[s.id].status, "restarting");
  await stopService(s.id, "owner-restart-port");
  await new Promise(r => setTimeout(r, 5200));
  const stopped = await getService(s.id, "owner-restart-port");
  assert.equal(stopped.status, "stopped");
});

test("service persistence redacts secret environment values", async () => {
  resetStoreForTests();
  const s = await createService({
    ownerId: "owner-secret",
    buildId: "build-secret",
    command: "sleep 5",
    cwd: process.cwd(),
    env: { API_TOKEN: "super-secret", PUBLIC_MODE: "true" }
  });
  await stopService(s.id, "owner-secret");
  const store = await getStore();
  assert.equal(store.services[s.id].env.API_TOKEN, "[REDACTED]");
  assert.equal(store.services[s.id].env.PUBLIC_MODE, "true");
  assert.notEqual(store.services[s.id].env.API_TOKEN, "super-secret");
});

test("healthy service activates its route after readiness check", async () => {
  resetStoreForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  let s;
  try {
    s = await createService({
      ownerId: "owner-health-route",
      buildId: "build-health-route",
      command: "sleep 5",
      cwd: process.cwd(),
      healthUrl: "http://127.0.0.1:19002/health",
      port: 19002
    });
    await createRoute({
      ownerId: "owner-health-route",
      hostname: "ready.example.com",
      serviceId: s.id,
      targetPort: s.port
    });
    const route = await findRouteByHostname("ready.example.com");
    await setRouteStatus(route.id, "owner-health-route", "disabled");
    const result = await monitorService(s.id, "owner-health-route");
    assert.equal(result.health.ok, true);
    assert.equal((await findRouteByHostname("ready.example.com")).serviceId, s.id);
    await stopService(s.id, "owner-health-route");
  } finally {
    globalThis.fetch = originalFetch;
    if (s) await stopService(s.id, "owner-health-route").catch(() => {});
  }
});

test("health monitor restart ignores the old runtime exit", async () => {
  resetStoreForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  let s;
  try {
    s = await createService({
      ownerId: "owner-monitor-race",
      buildId: "build-monitor-race",
      command: "sleep 5",
      cwd: process.cwd(),
      healthUrl: "http://127.0.0.1:19001/health",
      port: 19001
    });
    const beforeRestart = await getStore();
    const restartTokenBefore = beforeRestart.services[s.id]?.restartToken ?? 0;
    const result = await monitorService(s.id, "owner-monitor-race");
    assert.equal(result.restarted, true);
    const afterRestart = await getStore();
    assert.equal(afterRestart.services[s.id].restartToken, restartTokenBefore + 1);
    const current = await getService(s.id, "owner-monitor-race");
    assert.equal(current.status, "running");
    assert.equal(current.restartCount, 1);
    await new Promise(r => setTimeout(r, 50));
    const afterOldExit = await getService(s.id, "owner-monitor-race");
    assert.equal(afterOldExit.status, "running");
    assert.equal(afterOldExit.restartCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (s) await stopService(s.id, "owner-monitor-race").catch(() => {});
  }
});
