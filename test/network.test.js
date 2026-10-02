import test from "node:test";
import assert from "node:assert/strict";
import { createRoute, findRouteByHostname, listRoutes, setRouteStatus, networkInfo } from "../src/network.js";
import { resetStoreForTests, updateStore } from "../src/store.js";

test("network route is owner scoped and hostname normalized", async () => {
  resetStoreForTests();
  await updateStore(s => { s.services["svc-1"] = { id:"svc-1", ownerId:"owner-net", status:"running" }; return s; });
  const route = await createRoute({ ownerId:"owner-net", hostname:"APP.Example.COM", serviceId:"svc-1", targetPort:3210 });
  assert.equal(route.hostname, "app.example.com");
  assert.equal(route.targetPort, 3210);
  assert.equal((await findRouteByHostname("APP.EXAMPLE.COM")).id, route.id);
  assert.equal((await listRoutes("other")).length, 0);
});

test("network route rejects duplicate hostname and invalid ports", async () => {
  resetStoreForTests();
  await updateStore(s => { s.services["svc-1"] = { id:"svc-1", ownerId:"owner-net", status:"running" }; s.services["svc-2"] = { id:"svc-2", ownerId:"owner-net", status:"running" }; return s; });
  await createRoute({ ownerId:"owner-net", hostname:"app.example.com", serviceId:"svc-1", targetPort:3210 });
  await assert.rejects(() => createRoute({ ownerId:"owner-net", hostname:"app.example.com", serviceId:"svc-2", targetPort:3211 }), /Hostname already routed/);
  await assert.rejects(() => createRoute({ ownerId:"owner-net", hostname:"bad", serviceId:"svc-2", targetPort:3211 }), /Invalid route hostname/);
  await assert.rejects(() => createRoute({ ownerId:"owner-net", hostname:"api.example.com", serviceId:"svc-2", targetPort:70000 }), /valid targetPort/);
});

test("disabled route is no longer routable", async () => {
  resetStoreForTests();
  await updateStore(s => { s.services["svc-1"] = { id:"svc-1", ownerId:"owner-net" }; return s; });
  const route = await createRoute({ ownerId:"owner-net", hostname:"api.example.com", serviceId:"svc-1", targetPort:3210 });
  await setRouteStatus(route.id, "owner-net", "disabled");
  assert.equal(await findRouteByHostname(route.hostname), null);
});

test("network info exposes persistent routing capability", () => {
  const info = networkInfo();
  assert.equal(info.persistent, true);
  assert.equal(info.routing, "hostname_to_service");
});

test("route target is restricted to loopback", async () => {
  resetStoreForTests();
  await updateStore(s => { s.services["svc-1"] = { id:"svc-1", ownerId:"owner-net" }; return s; });
  await assert.rejects(() => createRoute({ ownerId:"owner-net", hostname:"safe.example.com", serviceId:"svc-1", targetHost:"169.254.169.254", targetPort:3210 }), /loopback/);
});

test("health-gated service routes start disabled until readiness", async () => {
  resetStoreForTests();
  await updateStore(s => {
    s.services["svc-health-gated"] = {
      id:"svc-health-gated",
      ownerId:"owner-net",
      status:"running",
      healthUrl:"http://127.0.0.1:19003/health"
    };
    return s;
  });
  const route = await createRoute({
    ownerId:"owner-net",
    hostname:"health.example.com",
    serviceId:"svc-health-gated",
    targetPort:19003
  });
  assert.equal(route.status, "disabled");
  assert.equal(await findRouteByHostname("health.example.com"), null);
  await assert.rejects(
    () => setRouteStatus(route.id, "owner-net", "active"),
    error => error.code === "ROUTE_SERVICE_UNHEALTHY"
  );
  const store = await (async () => {
    const { getStore } = await import("../src/store.js");
    return getStore();
  })();
  store.services["svc-health-gated"].healthUrl = null;
  await (async () => {
    const { updateStore } = await import("../src/store.js");
    await updateStore(s => {
      s.services["svc-health-gated"].healthUrl = null;
      return s;
    });
  })();
  await setRouteStatus(route.id, "owner-net", "active");
  assert.equal((await findRouteByHostname("health.example.com")).id, route.id);
});
