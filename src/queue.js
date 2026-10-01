import { getStore, updateStore } from "./store.js";
import crypto from "node:crypto";
import { JOB_STATUS } from "./jobs.js";

function makeId() {
  return "job_" + crypto.randomUUID();
}

export async function enqueue(type, payload = {}) {
  const id = makeId();
  let job;
  await updateStore(store => {
    job = {
      id,
      type,
      payload,
      status: JOB_STATUS.QUEUED,
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
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
      if (job.status === JOB_STATUS.QUEUED) {
        job.status = JOB_STATUS.RUNNING;
        job.attempts += 1;
        job.updatedAt = new Date().toISOString();
        found = { ...job };
        break;
      }
    }
    return store;
  });
  return found;
}

export async function finishJob(id, result) {
  let job = null;
  await updateStore(store => {
    const item = store.jobs?.[id];
    if (!item) return store;
    item.status = JOB_STATUS.SUCCEEDED;
    item.result = result;
    item.updatedAt = new Date().toISOString();
    job = { ...item };
    return store;
  });
  return job;
}

export async function failJob(id, error, retry = false) {
  let job = null;
  await updateStore(store => {
    const item = store.jobs?.[id];
    if (!item) return store;
    item.status = retry ? JOB_STATUS.QUEUED : JOB_STATUS.FAILED;
    item.error = error?.message || String(error);
    item.updatedAt = new Date().toISOString();
    job = { ...item };
    return store;
  });
  return job;
}

export async function getStoredJob(id) {
  const store = await getStore();
  return store.jobs?.[id] ? { ...store.jobs[id] } : null;
}
