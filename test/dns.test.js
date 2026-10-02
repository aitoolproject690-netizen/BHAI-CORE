import test from "node:test";
import assert from "node:assert/strict";
import { resetStoreForTests, updateStore } from "../src/store.js";
import { createDnsChallenge, getDnsChallenge, listDnsChallenges, dnsInfo } from "../src/dns.js";
test("DNS challenge records are owner scoped",async()=>{resetStoreForTests();await updateStore(s=>{s.domains["d1"]={id:"d1",ownerId:"u1"};return s;});const r=await createDnsChallenge({ownerId:"u1",domainId:"d1",hostname:"app.example.com",name:"_acme-challenge.app.example.com",value:"token"});assert.equal(r.status,"pending");assert.equal(await getDnsChallenge(r.id,"u2"),null);assert.equal((await listDnsChallenges("u1")).length,1);});
test("DNS info exposes supported record types",()=>{const i=dnsInfo();assert.ok(i.recordTypes.includes("TXT"));assert.ok(i.recordTypes.includes("CNAME"));});
