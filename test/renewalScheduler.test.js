import test from "node:test";
import assert from "node:assert/strict";
import { resetStoreForTests, updateStore, getStore } from "../src/store.js";
import { runRenewalSweep, renewalSchedulerInfo, createRenewalScheduler } from "../src/renewalScheduler.js";

test("renewal sweep marks due and expired certificates", async () => {
  resetStoreForTests(); const now=Date.now();
  await updateStore(s=>{s.certificates={
    due:{id:"due",ownerId:"u1",status:"active",expiresAt:new Date(now+86400000).toISOString()},
    fresh:{id:"fresh",ownerId:"u1",status:"active",expiresAt:new Date(now+864000000).toISOString()},
    old:{id:"old",ownerId:"u2",status:"active",expiresAt:new Date(now-1000).toISOString()}
  };return s;});
  const result=await runRenewalSweep(now);
  assert.equal(result.checked,3); assert.equal(result.markedRenewing,1); assert.equal(result.markedExpired,1);
  const store=await getStore(); assert.equal(store.certificates.due.status,"renewing"); assert.equal(store.certificates.old.status,"expired");
});

test("scheduler clamps unsafe intervals", () => {
  const scheduler=createRenewalScheduler({intervalMs:1}); assert.ok(scheduler.info().intervalMs>=60000); scheduler.stop();
  assert.ok("externalDnsRequired" in renewalSchedulerInfo());
});
