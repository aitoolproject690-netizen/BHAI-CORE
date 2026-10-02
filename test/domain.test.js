import test from "node:test";
import assert from "node:assert/strict";
import { createDomain, getDomain, listDomains, setDomainStatus, attachDomainRoute, rebindDomainServices } from "../src/domain.js";
import { resetStoreForTests, updateStore } from "../src/store.js";
import { createDnsChallenge, setDnsChallengeStatus } from "../src/dns.js";

test("domains are owner-scoped and normalize hostname", async () => {
  resetStoreForTests();
  await updateStore(s => { s.services["svc_1"] = { id:"svc_1", ownerId:"user-a", status:"running" }; return s; });
  const domain = await createDomain({ ownerId:"user-a", serviceId:"svc_1", hostname:"APP.Example.COM" });
  assert.equal(domain.hostname, "app.example.com");
  assert.equal((await listDomains("user-a")).length, 1);
  assert.equal(await getDomain(domain.id, "user-b"), null);
});

test("domain activation requires exact verified TXT challenge", async () => {
  resetStoreForTests();
  await updateStore(s => {
    s.services["svc_1"] = { id:"svc_1", ownerId:"user-a", status:"running" };
    return s;
  });
  const domain = await createDomain({ ownerId:"user-a", serviceId:"svc_1", hostname:"app.example.com" });
  const other = await createDnsChallenge({
    ownerId:"user-a", domainId:domain.id, hostname:domain.hostname,
    name:"_acme-challenge.app.example.com", value:"token", type:"CNAME"
  });
  await updateStore(s => { s.dnsRecords[other.id].status = "verified"; return s; });
  await assert.rejects(
    () => setDomainStatus(domain.id, "user-a", "active"),
    error => error.code === "DOMAIN_DNS_NOT_VERIFIED"
  );
  const valid = await createDnsChallenge({
    ownerId:"user-a", domainId:domain.id, hostname:domain.hostname,
    name:"_acme-challenge.app.example.com", value:"token2", type:"TXT"
  });
  await updateStore(s => { s.dnsRecords[valid.id].status = "verified"; return s; });
  assert.equal((await setDomainStatus(domain.id, "user-a", "active")).status, "active");
});

test("domain status is validated", async () => {
  resetStoreForTests();
  await updateStore(s => { s.services["svc_1"] = { id:"svc_1", ownerId:"user-a", status:"running" }; return s; });
  const domain = await createDomain({ ownerId:"user-a", serviceId:"svc_1", hostname:"app.example.com" });
  const dns = await createDnsChallenge({ ownerId:"user-a", domainId:domain.id, hostname:domain.hostname, name:"_acme-challenge."+domain.hostname, value:"verified-token" });
  await updateStore(s => { s.dnsRecords[dns.id].status = "verified"; return s; });
  assert.equal((await setDomainStatus(domain.id, "user-a", "active")).status, "active");
  await assert.rejects(() => setDomainStatus(domain.id, "user-a", "running"), error => error.code === "DOMAIN_STATUS_INVALID");
  await assert.rejects(() => createDomain({ ownerId:"user-a", serviceId:"svc_1", hostname:"localhost" }), error => error.code === "DOMAIN_FIELDS_REQUIRED");
});


test("domain can persist its ingress route binding", async () => {
  resetStoreForTests();
  await updateStore(s => { s.services["svc_1"] = { id:"svc_1", ownerId:"user-a" }; s.routes["rte_1"] = { id:"rte_1", ownerId:"user-a", serviceId:"svc_1" }; return s; });
  const domain = await createDomain({ ownerId:"user-a", serviceId:"svc_1", hostname:"app.example.com" });
  const linked = await attachDomainRoute(domain.id, "user-a", "rte_1");
  assert.equal(linked.routeId, "rte_1");
  assert.equal((await getDomain(domain.id, "user-a")).routeId, "rte_1");
});


test("domain rebind requires owner context", async () => {
  await assert.rejects(() => rebindDomainServices("svc-from", "svc-target"), error => error.code === "DOMAIN_OWNER_REQUIRED");
});

test("domain rebind validates target service ownership", async () => {
  resetStoreForTests();
  await updateStore(s => {
    s.services["svc-from"] = { id:"svc-from", ownerId:"owner-a", status:"running" };
    s.services["svc-target"] = { id:"svc-target", ownerId:"owner-a", status:"running" };
    s.services["svc-other"] = { id:"svc-other", ownerId:"owner-b", status:"running" };
    s.domains["dom-1"] = {
      id:"dom-1", ownerId:"owner-a", serviceId:"svc-from",
      hostname:"app.example.com", status:"active", tls:"managed",
      routeId:null, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()
    };
    return s;
  });
  await assert.rejects(
    () => rebindDomainServices("svc-from", "svc-other", "owner-a"),
    error => error.code === "DOMAIN_SERVICE_FORBIDDEN"
  );
  assert.equal(await rebindDomainServices("svc-from", "svc-target", "owner-a"), 1);
  assert.equal((await getDomain("dom-1", "owner-a")).serviceId, "svc-target");
});


test("domain creation rejects hostname already used by a route before persisting", async () => {
  resetStoreForTests();
  await updateStore(s => {
    s.services["svc-domain-conflict"] = {
      id: "svc-domain-conflict",
      ownerId: "owner-domain",
      status: "running",
      port: 3210
    };
    s.routes["route-domain-conflict"] = {
      id: "route-domain-conflict",
      ownerId: "owner-domain",
      hostname: "taken.example.com",
      serviceId: "svc-domain-conflict",
      targetHost: "127.0.0.1",
      targetPort: 3210,
      status: "active"
    };
    return s;
  });
  await assert.rejects(
    () => createDomain({
      ownerId: "owner-domain",
      serviceId: "svc-domain-conflict",
      hostname: "TAKEN.EXAMPLE.COM"
    }),
    error => error.code === "DOMAIN_HOST_CONFLICT"
  );
  const store = await getStore();
  assert.equal(Object.keys(store.domains || {}).length, 0);
});

test("domain creation rejects a service with an invalid port", async () => {
  resetStoreForTests();
  await updateStore(s => {
    s.services["svc-domain-invalid-port"] = {
      id: "svc-domain-invalid-port",
      ownerId: "owner-domain",
      status: "running",
      port: 70000
    };
    return s;
  });
  await assert.rejects(
    () => createDomain({
      ownerId: "owner-domain",
      serviceId: "svc-domain-invalid-port",
      hostname: "invalid-port.example.com"
    }),
    error => error.code === "DOMAIN_SERVICE_PORT_INVALID"
  );
  const store = await getStore();
  assert.equal(Object.keys(store.domains || {}).length, 0);
});
