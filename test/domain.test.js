import test from "node:test";
import assert from "node:assert/strict";
import { createDomain, getDomain, listDomains, setDomainStatus } from "../src/domain.js";
import { resetStoreForTests } from "../src/store.js";

test("domains are owner-scoped and normalize hostname", async () => {
  resetStoreForTests();
  const domain = await createDomain({ ownerId:"user-a", serviceId:"svc_1", hostname:"APP.Example.COM" });
  assert.equal(domain.hostname, "app.example.com");
  assert.equal((await listDomains("user-a")).length, 1);
  assert.equal(await getDomain(domain.id, "user-b"), null);
});

test("domain status is validated", async () => {
  resetStoreForTests();
  const domain = await createDomain({ ownerId:"user-a", serviceId:"svc_1", hostname:"app.example.com" });
  assert.equal((await setDomainStatus(domain.id, "user-a", "active")).status, "active");
  await assert.rejects(() => setDomainStatus(domain.id, "user-a", "running"), error => error.code === "DOMAIN_STATUS_INVALID");
  await assert.rejects(() => createDomain({ ownerId:"user-a", serviceId:"svc_1", hostname:"localhost" }), error => error.code === "DOMAIN_FIELDS_REQUIRED");
});
