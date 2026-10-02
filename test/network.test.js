import test from "node:test";
import assert from "node:assert/strict";
import { createRoute, findRouteByHostname, listRoutes, setRouteStatus, networkInfo, rebindServiceRoutes, stripHopByHopHeaders } from "../src/network.js";
import { resetStoreForTests, updateStore } from "../src/store.js";

test("network route is owner scoped and hostname normalized", async () => {
  resetStoreForTests();
  await updateStore(s => { s.services["svc-1"] = { id:"svc-1", ownerId:"owner-net", status:"running", port:3210 }; return s; });
  const route = await createRoute({ ownerId:"owner-net", hostname:"APP.Example.COM", serviceId:"svc-1", targetPort:3210 });
  assert.equal(route.hostname, "app.example.com");
  assert.equal(route.targetPort, 3210);
  assert.equal((await findRouteByHostname("APP.EXAMPLE.COM")).id, route.id);
  assert.equal((await listRoutes("other")).length, 0);
});

test("network route rejects duplicate hostname and invalid ports", async () => {
  resetStoreForTests();
  await updateStore(s => {
    s.services["svc-1"] = { id:"svc-1", ownerId:"owner-net", status:"running", port:3210 };
    s.services["svc-2"] = { id:"svc-2", ownerId:"owner-net", status:"running", port:3211 };
    return s;
  });
  await createRoute({ ownerId:"owner-net", hostname:"app.example.com", serviceId:"svc-1", targetPort:3210 });
  await assert.rejects(() => createRoute({ ownerId:"owner-net", hostname:"app.example.com", serviceId:"svc-2", targetPort:3211 }), /Hostname already routed/);
  await assert.rejects(() => createRoute({ ownerId:"owner-net", hostname:"bad", serviceId:"svc-2", targetPort:3211 }), /Invalid route hostname/);
  await assert.rejects(() => createRoute({ ownerId:"owner-net", hostname:"api.example.com", serviceId:"svc-2", targetPort:70000 }), /valid targetPort/);
});

test("disabled route is no longer routable", async () => {
  resetStoreForTests();
  await updateStore(s => { s.services["svc-1"] = { id:"svc-1", ownerId:"owner-net", status:"running", port:3210 }; return s; });
  const route = await createRoute({ ownerId:"owner-net", hostname:"api.example.com", serviceId:"svc-1", targetPort:3210 });
  await setRouteStatus(route.id, "owner-net", "disabled");
  assert.equal(await findRouteByHostname(route.hostname), null);
});

test("network info exposes persistent routing capability", () => {
  const info = networkInfo();
  assert.equal(info.persistent, true);
  assert.equal(info.routing, "hostname_to_service");
});

test("route target port must match the service port", async () => {
  resetStoreForTests();
  await updateStore(s => { s.services["svc-1"] = { id:"svc-1", ownerId:"owner-net", status:"running", port:3210 }; return s; });
  await assert.rejects(
    () => createRoute({ ownerId:"owner-net", hostname:"wrong-port.example.com", serviceId:"svc-1", targetPort:3211 }),
    error => error.code === "ROUTE_TARGET_PORT_MISMATCH"
  );
});

test("route rejects a service with an invalid port", async () => {
  resetStoreForTests();
  await updateStore(s => { s.services["svc-invalid-port"] = { id:"svc-invalid-port", ownerId:"owner-net", status:"running" }; return s; });
  await assert.rejects(
    () => createRoute({ ownerId:"owner-net", hostname:"invalid-port.example.com", serviceId:"svc-invalid-port", targetPort:3210 }),
    error => error.code === "ROUTE_SERVICE_PORT_INVALID"
  );
});

test("route target is restricted to loopback", async () => {
  resetStoreForTests();
  await updateStore(s => { s.services["svc-1"] = { id:"svc-1", ownerId:"owner-net", status:"running", port:3210 }; return s; });
  await assert.rejects(() => createRoute({ ownerId:"owner-net", hostname:"safe.example.com", serviceId:"svc-1", targetHost:"169.254.169.254", targetPort:3210 }), /loopback/);
});

test("health-gated service routes start disabled until readiness", async () => {
  resetStoreForTests();
  await updateStore(s => {
    s.services["svc-health-gated"] = {
      id:"svc-health-gated",
      ownerId:"owner-net",
      status:"running",
      healthUrl:"http://127.0.0.1:19003/health",
      port:19003
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
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok:true, status:200 });
  try {
    await setRouteStatus(route.id, "owner-net", "active");
    assert.equal((await findRouteByHostname("health.example.com")).id, route.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("route rebind requires owner context", async () => {
  await assert.rejects(() => rebindServiceRoutes("svc-from", "svc-target", 3300), error => error.code === "ROUTE_OWNER_REQUIRED");
});

test("route rebind validates target service ownership and port", async () => {
  resetStoreForTests();
  await updateStore(s => {
    s.services["svc-from"] = { id:"svc-from", ownerId:"owner-a", status:"running", port:3200 };
    s.services["svc-target"] = { id:"svc-target", ownerId:"owner-a", status:"running", port:3300 };
    s.services["svc-other"] = { id:"svc-other", ownerId:"owner-b", status:"running", port:3400 };
    s.routes["rte-1"] = {
      id:"rte-1", ownerId:"owner-a", hostname:"app.example.com",
      serviceId:"svc-from", targetHost:"127.0.0.1", targetPort:3200,
      status:"active"
    };
    return s;
  });
  await assert.rejects(
    () => rebindServiceRoutes("svc-from", "svc-other", 3400, "owner-a"),
    error => error.code === "ROUTE_SERVICE_FORBIDDEN"
  );
  await assert.rejects(
    () => rebindServiceRoutes("svc-from", "svc-target", 70000, "owner-a"),
    error => error.code === "ROUTE_TARGET_PORT_INVALID"
  );
  assert.equal(await rebindServiceRoutes("svc-from", "svc-target", 3300, "owner-a"), 1);
  assert.equal((await findRouteByHostname("app.example.com")).targetPort, 3300);
});

test("route rebind uses target service port when targetPort is omitted", async () => {
  resetStoreForTests();
  await updateStore(s => {
    s.services["svc-from"] = { id:"svc-from", ownerId:"owner-a", status:"running", port:3200 };
    s.services["svc-target"] = { id:"svc-target", ownerId:"owner-a", status:"running", port:3300 };
    s.routes["rte-2"] = {
      id:"rte-2", ownerId:"owner-a", hostname:"default-port.example.com",
      serviceId:"svc-from", targetHost:"127.0.0.1", targetPort:3200,
      status:"active"
    };
    return s;
  });
  assert.equal(await rebindServiceRoutes("svc-from", "svc-target", undefined, "owner-a"), 1);
  assert.equal((await findRouteByHostname("default-port.example.com")).targetPort, 3300);
});

test("proxy strips hop-by-hop and connection-nominated headers", () => {
  const headers = stripHopByHopHeaders({
    connection: "keep-alive, x-private-hop",
    "keep-alive": "timeout=5",
    "x-private-hop": "secret",
    "proxy-authorization": "Basic secret",
    "content-type": "application/json",
    "x-forwarded-for": "127.0.0.1"
  });
  assert.equal(headers.connection, undefined);
  assert.equal(headers["keep-alive"], undefined);
  assert.equal(headers["x-private-hop"], undefined);
  assert.equal(headers["proxy-authorization"], undefined);
  assert.equal(headers["content-type"], "application/json");
  assert.equal(headers["x-forwarded-for"], "127.0.0.1");
});
