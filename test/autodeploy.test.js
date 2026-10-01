import test from "node:test";
import assert from "node:assert/strict";
import { createAutoDeploy, getAutoDeploy, listAutoDeploys, setAutoDeployStatus, recordAutoDeployRun, claimWebhookDelivery } from "../src/autodeploy.js";
import { resetStoreForTests } from "../src/store.js";

test("auto-deploy is owner scoped", async () => {
  resetStoreForTests();
  const hook = await createAutoDeploy({ ownerId:"user-a", repository:"owner/app" });
  assert.match(hook.id, /^hook_/);
  assert.equal((await listAutoDeploys("user-a")).length, 1);
  assert.equal(await getAutoDeploy(hook.id, "user-b"), null);
});

test("auto-deploy status and run state are validated", async () => {
  resetStoreForTests();
  const hook = await createAutoDeploy({ ownerId:"user-a", repository:"owner/app" });
  assert.equal((await setAutoDeployStatus(hook.id, "user-a", "disabled")).status, "disabled");
  await assert.rejects(() => setAutoDeployStatus(hook.id, "user-a", "running-now"), e => e.code === "AUTODEPLOY_STATUS_INVALID");
  const updated = await recordAutoDeployRun(hook.id, "user-a", { commit:"abc123", deploymentId:"dep_1", status:"succeeded" });
  assert.equal(updated.lastCommit, "abc123");
  assert.equal(updated.lastDeploymentId, "dep_1");
});


test("GitHub webhook delivery is accepted once and then rejected as duplicate", async () => {
  resetStoreForTests();
  const first = await claimWebhookDelivery("delivery-123", 60000);
  const second = await claimWebhookDelivery("delivery-123", 60000);
  assert.equal(first.accepted, true);
  assert.equal(first.reason, "new");
  assert.equal(second.accepted, false);
  assert.equal(second.reason, "duplicate");
});

test("missing webhook delivery id is not accepted", async () => {
  resetStoreForTests();
  const result = await claimWebhookDelivery("");
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "missing");
});
