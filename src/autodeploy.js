import crypto from "node:crypto";
import { getStore, updateStore } from "./store.js";

const STATUSES = new Set(["enabled", "disabled", "running", "failed"]);

function publicHook(h) {
  return {
    id:h.id, ownerId:h.ownerId, repository:h.repository, branch:h.branch,
    status:h.status, lastCommit:h.lastCommit, lastDeploymentId:h.lastDeploymentId,
    lastError:h.lastError, createdAt:h.createdAt, updatedAt:h.updatedAt
  };
}

export async function createAutoDeploy({ ownerId, repository, branch = "main" } = {}) {
  if (!ownerId || !repository || !branch)
    throw Object.assign(new Error("ownerId, repository and branch required"), { code:"AUTODEPLOY_FIELDS_REQUIRED", status:400 });
  const id = "hook_" + crypto.randomUUID();
  const now = new Date().toISOString();
  const hook = { id, ownerId, repository, branch, status:"enabled", lastCommit:null, lastDeploymentId:null, lastError:null, createdAt:now, updatedAt:now };
  await updateStore(store => { store.autoDeploy ??= {}; store.autoDeploy[id] = hook; return store; });
  return publicHook(hook);
}

export async function getAutoDeploy(id, ownerId) {
  const store = await getStore();
  const h = store.autoDeploy?.[id];
  return h && h.ownerId === ownerId ? publicHook(h) : null;
}

export async function listAutoDeploys(ownerId) {
  const store = await getStore();
  return Object.values(store.autoDeploy || {}).filter(h => h.ownerId === ownerId).map(publicHook);
}

export async function setAutoDeployStatus(id, ownerId, status) {
  if (!STATUSES.has(status))
    throw Object.assign(new Error("Invalid auto-deploy status"), { code:"AUTODEPLOY_STATUS_INVALID", status:400 });
  let found = false;
  await updateStore(store => {
    const h = store.autoDeploy?.[id];
    if (!h || h.ownerId !== ownerId) return store;
    h.status = status;
    h.updatedAt = new Date().toISOString();
    found = true;
    return store;
  });
  return found ? getAutoDeploy(id, ownerId) : null;
}

export async function recordAutoDeployRun(id, ownerId, { commit, deploymentId, status, error = null } = {}) {
  let found = false;
  await updateStore(store => {
    const h = store.autoDeploy?.[id];
    if (!h || h.ownerId !== ownerId) return store;
    h.status = status === "failed" ? "failed" : "enabled";
    h.lastCommit = commit || null;
    h.lastDeploymentId = deploymentId || null;
    h.lastError = error || null;
    h.updatedAt = new Date().toISOString();
    found = true;
    return store;
  });
  return found ? getAutoDeploy(id, ownerId) : null;
}

export function autoDeployInfo() {
  return { persistent:true, ownerScoped:true, statuses:[...STATUSES], trigger:"github_push", webhookSecretRequired:true };
}
