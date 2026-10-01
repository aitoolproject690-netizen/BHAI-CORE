import { getStore, updateStore } from "./store.js";
import crypto from "node:crypto";
import { JOB_STATUS } from "./jobs.js";

const LEASE_MS = Number(process.env.BHAI_JOB_LEASE_MS || 10 * 60 * 1000);

function makeId() { return "job_" + crypto.randomUUID(); }

export async function enqueue(type, payload = {}) {
  const id = makeId();
  let job;
  await updateStore(store => {
    job = { id, type, payload, ownerId: payload?.ownerId || null, status: JOB_STATUS.QUEUED, attempts: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    store.jobs ??= {};
    store.jobs[id] = job;
    return store;
  });
  return { ...job };
}

export async function getQueuedJob() {
  let found = null;
  await updateStore(store => {
    store.jobs ??= {};
    for (const job of Object.values(store.jobs)) {
      if (job.status === JOB_STATUS.RUNNING && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) <= Date.now()) {
        job.status = JOB_STATUS.QUEUED;
        job.recoveredAt = new Date().toISOString();
        job.updatedAt = job.recoveredAt;
      }
    }
    for (const job of Object.values(store.jobs)) {
      if (job.status === JOB_STATUS.QUEUED) {
        job.status = JOB_STATUS.RUNNING;
        job.attempts += 1;
        job.leaseExpiresAt = new Date(Date.now() + LEASE_MS).toISOString();
        job.updatedAt = new Date().toISOString();
        found = { ...job };
        break;
      }
    }
    return store;
  });
  return found;
}

export async function heartbeatJob(id) {
  return updateJob(id, { leaseExpiresAt: new Date(Date.now() + LEASE_MS).toISOString() });
}

export async function updateJob(id, patch = {}) {
  let job = null;
  await updateStore(store => {
    const item = store.jobs?.[id];
    if (!item) return store;
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    job = { ...item };
    return store;
  });
  return job;
}

export async function finishJob(id, result) {
  return updateJob(id, { status: JOB_STATUS.SUCCEEDED, result, leaseExpiresAt: null });
}

export async function failJob(id, error, retry = false) {
  return updateJob(id, {
    status: retry ? JOB_STATUS.QUEUED : JOB_STATUS.FAILED,
    error: error?.message || String(error),
    leaseExpiresAt: null
  });
}

export async function getStoredJob(id) {
  const store = await getStore();
  return store.jobs?.[id] ? { ...store.jobs[id] } : null;
}

export function queueInfo() {
  return { leaseMs: LEASE_MS, persistent: true, recovery: "expired-running-jobs-requeued" };
}
