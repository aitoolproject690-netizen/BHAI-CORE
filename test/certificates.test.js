import test from "node:test";
import assert from "node:assert/strict";
import { resetStoreForTests } from "../src/store.js";
import { createCertificate, getCertificate, listCertificates, setCertificateStatus, certificateInfo } from "../src/certificates.js";
test("certificate lifecycle is owner scoped",async()=>{resetStoreForTests();const c=await createCertificate({ownerId:"u1",domainId:"dom1",hostname:"app.example.com"});assert.equal(c.status,"pending");assert.equal((await getCertificate(c.id,"u2")),null);assert.equal((await listCertificates("u1")).length,1);const r=await setCertificateStatus(c.id,"u1","ready",{expiresAt:"2030-01-01T00:00:00.000Z"});assert.equal(r.status,"ready");assert.equal(r.expiresAt,"2030-01-01T00:00:00.000Z");});
test("certificate info exposes safe capabilities",()=>{const i=certificateInfo();assert.equal(i.persistent,true);assert.ok(i.challengeTypes.includes("dns-01"));assert.ok(!JSON.stringify(i).includes("private"));});
