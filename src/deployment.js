import crypto from "node:crypto";
import { getStore, updateStore } from "./store.js";
import { getService, checkService } from "./service.js";

const STATUSES = new Set(["ready", "active", "stopped", "failed"]);

function productionKey({ ownerId, repository, branch }) {
  return `${ownerId}:${repository}:${branch}`;
}

function publicDeployment(d, production = false) {
  return {
    id:d.id, ownerId:d.ownerId, repository:d.repository, branch:d.branch,
    buildId:d.buildId, serviceId:d.serviceId || null, status:d.status,
    production:Boolean(production), createdAt:d.createdAt, updatedAt:d.updatedAt
  };
}

export async function createDeployment({ ownerId, repository, branch = "main", buildId, path, serviceId = null } = {}) {
  if (!ownerId || !repository || !buildId || !path)
    throw Object.assign(new Error("ownerId, repository, buildId and path required"), { code:"DEPLOYMENT_FIELDS_REQUIRED", status:400 });
  const id = "dep_" + crypto.randomUUID();
  const now = new Date().toISOString();
  const deployment = { id, ownerId, repository, branch, buildId, path, serviceId, status:"ready", createdAt:now, updatedAt:now };
  await updateStore(store => { store.deployments ??= {}; store.deployments[id] = deployment; return store; });
  return publicDeployment(deployment, false);
}

async function isProduction(id, ownerId) {
  const store = await getStore();
  return Object.values(store.production || {}).some(d => d === id && store.deployments?.[id]?.ownerId === ownerId);
}

export async function getDeployment(id, ownerId) {
  const store = await getStore();
  const d = store.deployments?.[id];
  return d && d.ownerId === ownerId ? publicDeployment(d, await isProduction(id, ownerId)) : null;
}

export async function listDeployments(ownerId) {
  const store = await getStore();
  const production = new Set(Object.values(store.production || {}));
  return Object.values(store.deployments || {})
    .filter(d => d.ownerId === ownerId)
    .map(d => publicDeployment(d, production.has(d.id)));
}

export async function setDeploymentStatus(id, ownerId, status) {
  if (!STATUSES.has(status))
    throw Object.assign(new Error("Invalid deployment status"), { code:"DEPLOYMENT_STATUS_INVALID", status:400 });
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

export async function attachDeploymentService(id, ownerId, serviceId) {
  if (!serviceId) throw Object.assign(new Error("serviceId required"), { code:"DEPLOYMENT_SERVICE_REQUIRED", status:400 });
  const store = await getStore();
  const deployment = store.deployments?.[id];
  const service = store.services?.[serviceId];
  if (!deployment || deployment.ownerId !== ownerId) return null;
  if (!service || service.ownerId !== ownerId)
    throw Object.assign(new Error("Deployment service ownership mismatch"), { code:"DEPLOYMENT_SERVICE_FORBIDDEN", status:403 });
  let found = false;
  await updateStore(store => {
    const d = store.deployments?.[id];
    if (!d || d.ownerId !== ownerId) return store;
    d.serviceId = serviceId;
    d.updatedAt = new Date().toISOString();
    found = true;
    return store;
  });
  return found ? getDeployment(id, ownerId) : null;
}

export async function promoteDeployment(id, ownerId) {
  const target = await getDeployment(id, ownerId);
  if (!target) return null;
  if (!target.serviceId)
    throw Object.assign(new Error("Deployment has no service"), { code:"DEPLOYMENT_SERVICE_MISSING", status:409 });
  const service = await getService(target.serviceId, ownerId);
  if (!service || service.status !== "running")
    throw Object.assign(new Error("Deployment service is not running"), { code:"DEPLOYMENT_NOT_READY", status:409 });
  if (service.healthUrl) {
    const checked = await checkService(target.serviceId, ownerId);
    if (!checked?.health?.ok)
      throw Object.assign(new Error("Deployment health check failed"), { code:"DEPLOYMENT_HEALTH_FAILED", status:409 });
  }

  const key = productionKey(target);
  const store = await getStore();
  const previousId = store.production?.[key] || null;
  const previous = previousId ? store.deployments?.[previousId] : null;

  await updateStore(next => {
    next.production ??= {};

    // Switch the production pointer and all owner-scoped traffic bindings in
    // one persisted transaction. This prevents a partial cutover where routes
    // point at the new service while the production pointer still references
    // the previous deployment.
    if (previous?.serviceId && previous.serviceId !== target.serviceId) {
      for (const route of Object.values(next.routes || {})) {
        if (
          route.ownerId === ownerId &&
          route.serviceId === previous.serviceId &&
          route.status === "active"
        ) {
          route.serviceId = target.serviceId;
          route.targetPort = Number(service.port);
          route.updatedAt = new Date().toISOString();
        }
      }
      for (const domain of Object.values(next.domains || {})) {
        if (domain.ownerId === ownerId && domain.serviceId === previous.serviceId) {
          domain.serviceId = target.serviceId;
          domain.updatedAt = new Date().toISOString();
        }
      }
    }

    next.production[key] = target.id;
    const d = next.deployments?.[target.id];
    if (d) {
      d.status = "active";
      d.updatedAt = new Date().toISOString();
    }
    return next;
  });

  return getDeployment(target.id, ownerId);
}

export async function rollbackDeployment(id, ownerId) {
  const target = await getDeployment(id, ownerId);
  if (!target) return null;

  const current = await getProductionDeployment({
    ownerId,
    repository: target.repository,
    branch: target.branch
  });
  if (!current)
    throw Object.assign(new Error("No production deployment exists"), { code:"ROLLBACK_NO_PRODUCTION", status:409 });
  if (current.id === target.id)
    throw Object.assign(new Error("Deployment is already production"), { code:"ROLLBACK_ALREADY_PRODUCTION", status:409 });

  if (target.status === "failed" || target.status === "stopped")
    throw Object.assign(new Error("Rollback target is not deployable"), { code:"ROLLBACK_TARGET_INVALID", status:409 });

  return promoteDeployment(target.id, ownerId);
}

export async function getProductionDeployment({ ownerId, repository, branch = "main" } = {}) {
  if (!ownerId || !repository) return null;
  const store = await getStore();
  const id = store.production?.[productionKey({ ownerId, repository, branch })];
  return id ? getDeployment(id, ownerId) : null;
}

export function deploymentInfo() {
  return {
    persistent: true,
    ownerScoped: true,
    statuses:[...STATUSES],
    autoStartSupported:true,
    rollbackSupported:true,
    productionPointer:true
  };
}
