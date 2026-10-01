import crypto from "node:crypto";

const jobs = new Map();

export function createJob(type, payload = {}) {
  const id = "job_" + crypto.randomUUID();
  const job = {
    id, type, payload,
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  jobs.set(id, job);
  return { ...job };
}

export function getJob(id) {
  const job = jobs.get(id);
  return job ? { ...job } : null;
}

export function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  return { ...job };
}

export function listJobs() {
  return [...jobs.values()].map(job => ({ ...job }));
}

export function resetJobs() {
  jobs.clear();
}
