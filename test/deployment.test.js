import test from "node:test";
import assert from "node:assert/strict";
import { createDeployment, getDeployment, listDeployments, setDeploymentStatus, promoteDeployment, rollbackDeployment, getProductionDeployment, attachDeploymentService } from "../src/deployment.js";
import { createService, stopService } from "../src/service.js";
import { resetStoreForTests, updateStore, getStore } from "../src/store.js";

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


test("deployment service attachment is owner scoped", async () => {
  resetStoreForTests();
  const deployment = await createDeployment({ ownerId:"user-a", repository:"owner/app", buildId:"build-attach", path:"/tmp/deployment" });
  await updateStore(s => { s.services["svc-other"] = { id:"svc-other", ownerId:"user-b" }; return s; });
  const { attachDeploymentService } = await import("../src/deployment.js");
  await assert.rejects(() => attachDeploymentService(deployment.id, "user-a", "svc-other"), error => error.code === "DEPLOYMENT_SERVICE_FORBIDDEN");
});


test("production cutover updates pointer and traffic bindings together", async () => {
  resetStoreForTests();
  process.env.BHAI_RUNTIME_ENABLED = "true";
  let oldService, newService;
  try {
    oldService = await createService({ ownerId:"user-a", buildId:"old", command:"sleep 5", cwd:process.cwd() });
    newService = await createService({ ownerId:"user-a", buildId:"new", command:"sleep 5", cwd:process.cwd() });

    const oldDeployment = await createDeployment({ ownerId:"user-a", repository:"owner/app", branch:"main", buildId:"old", path:"/tmp/old" });
    const newDeployment = await createDeployment({ ownerId:"user-a", repository:"owner/app", branch:"main", buildId:"new", path:"/tmp/new" });
    await attachDeploymentService(oldDeployment.id, "user-a", oldService.id);
    await attachDeploymentService(newDeployment.id, "user-a", newService.id);

    await updateStore(s => {
      s.production[`user-a:owner/app:main`] = oldDeployment.id;
      s.deployments[oldDeployment.id].status = "active";
      s.routes["route-cutover"] = {
        id:"route-cutover", ownerId:"user-a", hostname:"app.example.com",
        serviceId:oldService.id, targetHost:"127.0.0.1", targetPort:oldService.port, status:"active"
      };
      s.domains["domain-cutover"] = {
        id:"domain-cutover", ownerId:"user-a", serviceId:oldService.id,
        hostname:"app.example.com", status:"pending", tls:"managed", routeId:"route-cutover"
      };
      return s;
    });

    const promoted = await promoteDeployment(newDeployment.id, "user-a");
    assert.equal(promoted.id, newDeployment.id);
    const store = await getStore();
    assert.equal(store.production["user-a:owner/app:main"], newDeployment.id);
    assert.equal(store.routes["route-cutover"].serviceId, newService.id);
    assert.equal(store.routes["route-cutover"].targetPort, newService.port);
    assert.equal(store.domains["domain-cutover"].serviceId, newService.id);
  } finally {
    if (oldService) await stopService(oldService.id, "user-a").catch(() => {});
    if (newService) await stopService(newService.id, "user-a").catch(() => {});
    delete process.env.BHAI_RUNTIME_ENABLED;
  }
});
