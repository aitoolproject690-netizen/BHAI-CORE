import crypto from "node:crypto";
import { startRuntime, stopRuntime, healthCheck } from "./runtime.js";
import { getStore, updateStore } from "./store.js";
const services = new Map();

async function persistService(s) {
  const record = { id:s.id, ownerId:s.ownerId, buildId:s.buildId, command:s.command, cwd:s.cwd, env:s.env, healthUrl:s.healthUrl, status:s.status, restartCount:s.restartCount, pid:null, createdAt:s.createdAt, updatedAt:s.updatedAt };
  await updateStore(store => { store.services ??= {}; store.services[s.id] = record; return store; });
}

export async function restoreServices() {
  const store = await getStore();
  for (const record of Object.values(store.services || {})) services.set(record.id, { ...record, child:null, pid:null, status: record.status === "running" ? "stale" : record.status });
  return services.size;
}
const MAX_RESTARTS = Number(process.env.BHAI_RUNTIME_MAX_RESTARTS || 3);
const HEALTH_INTERVAL = Number(process.env.BHAI_RUNTIME_HEALTH_INTERVAL_MS || 15000);

export async function createService({ ownerId, buildId, command, cwd, env = {}, healthUrl = null } = {}) {
  if (!ownerId || !buildId) throw Object.assign(new Error("ownerId and buildId required"), { code: "SERVICE_IDENTITY_REQUIRED", status: 400 });
  const id = "svc_" + crypto.randomUUID();
  const service = { id, ownerId, buildId, command, cwd, env, healthUrl, status: "starting", restartCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), child: null };
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
  runtime.exit.then(async result => {
    if (!services.has(service.id)) return;
    if (service.status === "stopping") { service.status = "stopped"; return; }
    service.status = result.code === 0 ? "stopped" : "crashed";
    service.updatedAt = new Date().toISOString();
    await persistService(service);
    if (service.status === "crashed" && service.restartCount < MAX_RESTARTS) {
      service.restartCount++;
      service.status = "restarting";
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
    s.updatedAt = new Date().toISOString();
    await persistService(s);
  } else if (health.ok && s.status === "unhealthy") {
    s.status = "running";
    s.updatedAt = new Date().toISOString();
    await persistService(s);
  }
  return { id, status: s.status, health };
}
export function listServices(ownerId) {
  return [...services.values()].filter(s => s.ownerId === ownerId).map(publicService);
}
function publicService(s) {
  return { id:s.id, ownerId:s.ownerId, buildId:s.buildId, status:s.status, pid:s.pid || null, restartCount:s.restartCount, healthUrl:s.healthUrl, createdAt:s.createdAt, updatedAt:s.updatedAt };
}
export function serviceInfo() { return { enabled: process.env.BHAI_RUNTIME_ENABLED === "true", maxRestarts: MAX_RESTARTS, healthIntervalMs: HEALTH_INTERVAL, inMemory:true }; }
