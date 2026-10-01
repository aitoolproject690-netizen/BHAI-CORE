import test from "node:test";
import assert from "node:assert/strict";
import { createDeployment, getDeployment, listDeployments, setDeploymentStatus, promoteDeployment, rollbackDeployment, getProductionDeployment } from "../src/deployment.js";
import { resetStoreForTests } from "../src/store.js";

test("deployments are persistent and owner-scoped", async () => {
  resetStoreForTests();
  const deployment = await createDeployment({
    ownerId: "user-a",
    repository: "owner/app",
    branch: "main",
    buildId: "build-1",
    path: "/tmp/deployment"
  });
  assert.match(deployment.id, /^dep_/);
  assert.equal("path" in deployment, false);
  assert.equal((await listDeployments("user-a")).length, 1);
  assert.equal((await listDeployments("user-b")).length, 0);
  assert.equal(await getDeployment(deployment.id, "user-b"), null);
});

test("deployment status accepts only supported values", async () => {
  resetStoreForTests();
  const deployment = await createDeployment({
    ownerId: "user-a",
    repository: "owner/app",
    buildId: "build-2",
    path: "/tmp/deployment"
  });
  const active = await setDeploymentStatus(deployment.id, "user-a", "active");
  assert.equal(active.status, "active");
  await assert.rejects(
    () => setDeploymentStatus(deployment.id, "user-a", "running"),
    error => error.code === "DEPLOYMENT_STATUS_INVALID"
  );
});

test("deployment promotion requires an attached running service", async () => {
  resetStoreForTests();
  const deployment = await createDeployment({
    ownerId: "user-a",
    repository: "owner/app",
    branch: "main",
    buildId: "build-3",
    path: "/tmp/deployment"
  });
  await assert.rejects(
    () => promoteDeployment(deployment.id, "user-a"),
    error => error.code === "DEPLOYMENT_SERVICE_MISSING"
  );
  assert.equal(await getProductionDeployment({ ownerId:"user-a", repository:"owner/app", branch:"main" }), null);
});


test("rollback rejects when there is no production deployment", async () => {
  resetStoreForTests();
  const deployment = await createDeployment({
    ownerId: "user-a",
    repository: "owner/app",
    branch: "main",
    buildId: "build-rollback-1",
    path: "/tmp/deployment"
  });
  await assert.rejects(
    () => rollbackDeployment(deployment.id, "user-a"),
    error => error.code === "ROLLBACK_NO_PRODUCTION"
  );
});

test("rollback rejects the current production deployment", async () => {
  resetStoreForTests();
  const deployment = await createDeployment({
    ownerId: "user-a",
    repository: "owner/app",
    branch: "main",
    buildId: "build-rollback-2",
    path: "/tmp/deployment"
  });
  await assert.rejects(
    () => rollbackDeployment(deployment.id, "user-a"),
    error => error.code === "ROLLBACK_NO_PRODUCTION"
  );
});
