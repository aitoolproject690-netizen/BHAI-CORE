import crypto from "node:crypto";
import { getStore, updateStore } from "./store.js";

function publicDeployment(d) {
  return { id:d.id, ownerId:d.ownerId, repository:d.repository, branch:d.branch, buildId:d.buildId, path:d.path, status:d.status, createdAt:d.createdAt, updatedAt:d.updatedAt };
}

export async function createDeployment({ ownerId, repository, branch = "main", buildId, path } = {}) {
  if (!ownerId || !repository || !buildId || !path) throw Object.assign(new Error("ownerId, repository, buildId and path required"), { code:"DEPLOYMENT_FIELDS_REQUIRED", status:400 });
  const id = "dep_" + crypto.randomUUID();
  const now = new Date().toISOString();
  const deployment = { id, ownerId, repository, branch, buildId, path, status:"ready", createdAt:now, updatedAt:now };
  await updateStore(store => { store.deployments ??= {}; store.deployments[id] = deployment; return store; });
  return publicDeployment(deployment);
}

export async function getDeployment(id, ownerId) {
  const store = await getStore();
  const d = store.deployments?.[id];
  return d && d.ownerId === ownerId ? publicDeployment(d) : null;
}

export async function listDeployments(ownerId) {
  const store = await getStore();
  return Object.values(store.deployments || {}).filter(d => d.ownerId === ownerId).map(publicDeployment);
}

export async function setDeploymentStatus(id, ownerId, status) {
  let found = false;
  await updateStore(store => {
    const d = store.deployments?.[id];
    if (!d || d.ownerId !== ownerId) return store;
    d.status = status;
    d.updatedAt = new Date().toISOString();
    found = true;
    return store;
  });
  return found ? getDeployment(id, ownerId) : null;
}

export function deploymentInfo() {
  return { persistent: true, ownerScoped: true, statuses:["ready","active","stopped","failed"] };
}
