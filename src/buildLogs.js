import crypto from "node:crypto";
import { getStore, updateStore } from "./store.js";

const MAX_LOGS = Number(process.env.BHAI_BUILD_MAX_LOG_EVENTS || 1000);
const MAX_ARTIFACTS = Number(process.env.BHAI_BUILD_MAX_ARTIFACTS || 100);

export async function appendBuildLog(jobId, { phase = "unknown", level = "info", message = "" } = {}) {
  const event = { timestamp: new Date().toISOString(), phase: String(phase), level: String(level), message: String(message).slice(0, 8000) };
  await updateStore(store => {
    const job = store.jobs?.[jobId];
    if (!job) return store;
    job.buildLogs ??= [];
    job.buildLogs.push(event);
    if (job.buildLogs.length > MAX_LOGS) job.buildLogs.splice(0, job.buildLogs.length - MAX_LOGS);
    job.updatedAt = event.timestamp;
    return store;
  });
  return event;
}
export async function setBuildPhase(jobId, phase, extra = {}) {
  let result = null;
  await updateStore(store => {
    const job = store.jobs?.[jobId];
    if (!job) return store;
    Object.assign(job, { buildPhase: String(phase), ...extra, updatedAt: new Date().toISOString() });
    result = { ...job };
    return store;
  });
  return result;
}
export async function addBuildArtifact(jobId, artifact = {}) {
  const safe = { id: artifact.id || "artifact_" + crypto.randomUUID(), name: String(artifact.name || "artifact").slice(0, 200), path: String(artifact.path || "").slice(0, 1000), size: Number(artifact.size || 0), type: String(artifact.type || "file").slice(0, 100) };
  await updateStore(store => {
    const job = store.jobs?.[jobId];
    if (!job) return store;
    job.artifacts ??= [];
    job.artifacts.push(safe);
    if (job.artifacts.length > MAX_ARTIFACTS) job.artifacts.splice(0, job.artifacts.length - MAX_ARTIFACTS);
    job.updatedAt = new Date().toISOString();
    return store;
  });
  return safe;
}
export async function getBuildDetails(jobId, ownerId) {
  const store = await getStore();
  const job = store.jobs?.[jobId];
  if (!job || (ownerId && job.ownerId !== ownerId)) return null;
  return { id: job.id, type: job.type, status: job.status, buildPhase: job.buildPhase || null, attempts: job.attempts || 0, createdAt: job.createdAt, updatedAt: job.updatedAt, buildLogs: job.buildLogs || [], artifacts: job.artifacts || [], result: job.result || null, error: job.error || null };
}
export function buildLogInfo() { return { maxLogs: MAX_LOGS, maxArtifacts: MAX_ARTIFACTS, persistent: true }; }
