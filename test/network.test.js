import test from "node:test";
import assert from "node:assert/strict";
import { createRoute, findRouteByHostname, listRoutes, setRouteStatus, networkInfo } from "../src/network.js";
import { resetStoreForTests } from "../src/store.js";

test("network route is owner scoped and hostname normalized", async () => {
  resetStoreForTests();
  const route = await createRoute({ ownerId:"owner-net", hostname:"APP.Example.COM", serviceId:"svc-1", targetPort:3210 });
  assert.equal(route.hostname, "app.example.com");
  assert.equal(route.targetPort, 3210);
  assert.equal((await findRouteByHostname("APP.EXAMPLE.COM")).id, route.id);
  assert.equal((await listRoutes("other")).length, 0);
});

test("network route rejects duplicate hostname and invalid ports", async () => {
  resetStoreForTests();
  await createRoute({ ownerId:"owner-net", hostname:"app.example.com", serviceId:"svc-1", targetPort:3210 });
  await assert.rejects(() => createRoute({ ownerId:"owner-net", hostname:"app.example.com", serviceId:"svc-2", targetPort:3211 }), /Hostname already routed/);
  await assert.rejects(() => createRoute({ ownerId:"owner-net", hostname:"bad", serviceId:"svc-2", targetPort:3211 }), /Invalid route hostname/);
  await assert.rejects(() => createRoute({ ownerId:"owner-net", hostname:"api.example.com", serviceId:"svc-2", targetPort:70000 }), /valid targetPort/);
});

test("disabled route is no longer routable", async () => {
  resetStoreForTests();
  const route = await createRoute({ ownerId:"owner-net", hostname:"api.example.com", serviceId:"svc-1", targetPort:3210 });
  await setRouteStatus(route.id, "owner-net", "disabled");
  assert.equal(await findRouteByHostname(route.hostname), null);
});

test("network info exposes persistent routing capability", () => {
  const info = networkInfo();
  assert.equal(info.persistent, true);
  assert.equal(info.routing, "hostname_to_service");
});
