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
  await updateStore(s => { s.services["svc_1"] = { id:"svc_1", ownerId:"user-a" }; return s; });
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
