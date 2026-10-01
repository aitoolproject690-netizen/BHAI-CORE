import crypto from "node:crypto";
import { startRuntime, stopRuntime, healthCheck } from "./runtime.js";
import { getStore, updateStore } from "./store.js";
import { allocatePort, releasePort } from "./portAllocator.js";
import { setServiceRouteStatus } from "./network.js";
const services = new Map();

async function persistService(s) {
  const record = { id:s.id, ownerId:s.ownerId, buildId:s.buildId, command:s.command, cwd:s.cwd, env:s.env, healthUrl:s.healthUrl, port:s.port, status:s.status, restartCount:s.restartCount, pid:null, createdAt:s.createdAt, updatedAt:s.updatedAt };
  await updateStore(store => { store.services ??= {}; store.services[s.id] = record; return store; });
}

export async function restoreServices() {
  const store = await getStore();
  for (const record of Object.values(store.services || {})) {
    const restored = { ...record, child:null, pid:null, status: record.status === "running" ? "stale" : record.status };
    services.set(record.id, restored);
    if (restored.status === "stale" || restored.status === "stopped" || restored.status === "crashed") await setServiceRouteStatus(record.id, "disabled");
  }
  return services.size;
}
const MAX_RESTARTS = Number(process.env.BHAI_RUNTIME_MAX_RESTARTS || 3);
const HEALTH_INTERVAL = Number(process.env.BHAI_RUNTIME_HEALTH_INTERVAL_MS || 15000);

export async function createService({ ownerId, buildId, command, cwd, env = {}, healthUrl = null, port } = {}) {
  if (!ownerId || !buildId) throw Object.assign(new Error("ownerId and buildId required"), { code: "SERVICE_IDENTITY_REQUIRED", status: 400 });
  const id = "svc_" + crypto.randomUUID();
  const assignedPort = await allocatePort(port ?? env?.PORT);
  const serviceEnv = { ...env, PORT: String(assignedPort) };
  const service = { id, ownerId, buildId, command, cwd, env:serviceEnv, healthUrl, port:assignedPort, status: "starting", restartCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), child: null };
  services.set(id, service);
  await persistService(service);
  await launch(service);
  return publicService(service);
}
async function launch(service) {
  const runtime = startRuntime({ command: service.command, cwd: service.cwd, env: service.env });
  service.child = runtime.child;
  service.pid = runtime.pid;
  service.status = "running";
  service.updatedAt = new Date().toISOString();
  await persistService(service);
  // Services with a health URL remain unrouted until readiness succeeds.
  if (!service.healthUrl) await setServiceRouteStatus(service.id, "active");
  runtime.exit.then(async result => {
    if (!services.has(service.id)) return;
    if (service.status === "stopping" || service.status === "stopped") { service.status = "stopped"; await setServiceRouteStatus(service.id, "disabled"); service.updatedAt = new Date().toISOString(); await persistService(service); return; }
    service.status = result.code === 0 ? "stopped" : "crashed";
    service.updatedAt = new Date().toISOString();
    await setServiceRouteStatus(service.id, "disabled");
    await persistService(service);
    if (service.status === "crashed" && service.restartCount < MAX_RESTARTS) {
      service.restartCount++;
      service.status = "restarting";
      await persistService(service);
      await new Promise(r => setTimeout(r, Math.min(5000 * service.restartCount, 15000)));
      if (services.has(service.id)) await launch(service);
    }
  });
}
export async function getService(id, ownerId) {
  const s = services.get(id);
  return s && (!ownerId || s.ownerId === ownerId) ? publicService(s) : null;
}
export async function stopService(id, ownerId) {
  const s = services.get(id);
  if (!s || s.ownerId !== ownerId) return null;
  s.status = "stopping";
  await stopRuntime(s.child);
  await releasePort(s.port);
  await setServiceRouteStatus(s.id, "disabled");
  s.status = "stopped";
  s.updatedAt = new Date().toISOString();
  await persistService(s);
  return publicService(s);
}
export async function checkService(id, ownerId) {
  const s = services.get(id);
  if (!s || s.ownerId !== ownerId) return null;
  if (!s.healthUrl) return { id, status: s.status, health: null };
  const health = await healthCheck(s.healthUrl);
  if (!health.ok && s.status === "running") {
    s.status = "unhealthy";
    await setServiceRouteStatus(s.id, "disabled");
    s.updatedAt = new Date().toISOString();
    await persistService(s);
  } else if (health.ok && s.status === "unhealthy") {
    s.status = "running";
    await setServiceRouteStatus(s.id, "active");
    s.updatedAt = new Date().toISOString();
    await persistService(s);
  }
  return { id, status: s.status, health };
}
export function listServices(ownerId) {
  return [...services.values()].filter(s => s.ownerId === ownerId).map(publicService);
}
function publicService(s) {
  return { id:s.id, ownerId:s.ownerId, buildId:s.buildId, status:s.status, pid:s.pid || null, port:s.port, restartCount:s.restartCount, healthUrl:s.healthUrl, createdAt:s.createdAt, updatedAt:s.updatedAt };
}
export function serviceInfo() { return { enabled: process.env.BHAI_RUNTIME_ENABLED === "true", maxRestarts: MAX_RESTARTS, healthIntervalMs: HEALTH_INTERVAL, persistentMetadata:true }; }

export async function monitorService(id, ownerId) {
  const s = services.get(id);
  if (!s || s.ownerId !== ownerId) return null;
  const result = await checkService(id, ownerId);
  if (!result || !s.healthUrl) return result;
  if (!result.health.ok && s.status === "unhealthy" && s.restartCount < MAX_RESTARTS) {
    s.restartCount++;
    s.status = "restarting";
    await setServiceRouteStatus(s.id, "disabled");
    s.updatedAt = new Date().toISOString();
    await persistService(s);
    if (s.child) await stopRuntime(s.child);
    await launch(s);
    return { ...result, restarted: true, restartCount: s.restartCount };
  }
  return { ...result, restarted: false, restartCount: s.restartCount };
}

export async function createServiceFromDeployment({ ownerId, deployment, command, env = {}, healthUrl = null } = {}) {
  if (!deployment?.id || deployment.ownerId !== ownerId || !deployment.path)
    throw Object.assign(new Error("Valid owned deployment required"), { code:"DEPLOYMENT_REQUIRED", status:400 });
  return createService({ ownerId, buildId: deployment.id, command, cwd: deployment.path, env, healthUrl, port: env?.PORT });
}
