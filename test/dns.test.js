import test from "node:test";
import assert from "node:assert/strict";
import { resetStoreForTests, updateStore } from "../src/store.js";
import { createDnsChallenge, getDnsChallenge, listDnsChallenges, setDnsChallengeStatus, dnsInfo } from "../src/dns.js";
test("DNS challenge records are owner scoped",async()=>{resetStoreForTests();await updateStore(s=>{s.domains["d1"]={id:"d1",ownerId:"u1",hostname:"app.example.com"};return s;});const r=await createDnsChallenge({ownerId:"u1",domainId:"d1",hostname:"app.example.com",name:"_acme-challenge.app.example.com",value:"token"});assert.equal(r.status,"pending");assert.equal(await getDnsChallenge(r.id,"u2"),null);assert.equal((await listDnsChallenges("u1")).length,1);});
test("DNS info exposes supported record types",()=>{const i=dnsInfo();assert.ok(i.recordTypes.includes("TXT"));assert.ok(i.recordTypes.includes("CNAME"));});

test("DNS challenge records must belong to the domain hostname", async () => {
  resetStoreForTests();
  await updateStore(s => {
    s.domains["d1"] = { id:"d1", ownerId:"u1", hostname:"app.example.com" };
    return s;
  });
  await assert.rejects(
    () => createDnsChallenge({
      ownerId:"u1", domainId:"d1", hostname:"other.example.com",
      name:"_acme-challenge.other.example.com", value:"token"
    }),
    error => error.code === "DNS_HOSTNAME_MISMATCH"
  );
  await assert.rejects(
    () => createDnsChallenge({
      ownerId:"u1", domainId:"d1", hostname:"app.example.com",
      name:"_acme-challenge.other.example.com", value:"token"
    }),
    error => error.code === "DNS_NAME_MISMATCH"
  );
  const record = await createDnsChallenge({
    ownerId:"u1", domainId:"d1", hostname:"APP.Example.COM.",
    name:"_acme-challenge.APP.Example.COM.", value:"token"
  });
  assert.equal(record.hostname, "app.example.com");
  assert.equal(record.name, "_acme-challenge.app.example.com");
});

test("DNS verified status requires live verification", async () => {
  resetStoreForTests();
  await updateStore(s => {
    s.domains["d1"] = { id:"d1", ownerId:"u1", hostname:"app.example.com" };
    return s;
  });
  const record = await createDnsChallenge({ ownerId:"u1", domainId:"d1", hostname:"app.example.com", name:"_acme-challenge.app.example.com", value:"token" });
  await assert.rejects(() => setDnsChallengeStatus(record.id, "u1", "verified"), error => error.code === "DNS_VERIFICATION_REQUIRED");
});
