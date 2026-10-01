import crypto from "node:crypto";
import { getStore, updateStore } from "./store.js";

const MAX_EVENTS = Number(process.env.BHAI_AUDIT_MAX_EVENTS || 2000);

function sanitize(value) {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value);
  if (!text) return undefined;
  return text
    .replace(/(sk-|AIza|bhai_)[A-Za-z0-9._-]+/g, "[REDACTED]")
    .slice(0, 4000);
}

export async function recordAudit({ actorId, action, tool, status, requestId, metadata } = {}) {
  const event = {
    id: "audit_" + crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: actorId || "anonymous",
    action: String(action || "unknown"),
    tool: tool || undefined,
    status: String(status || "unknown"),
    requestId: requestId || undefined,
    metadata: sanitize(metadata)
  };
  await updateStore(store => {
    store.auditLog = Array.isArray(store.auditLog) ? store.auditLog : [];
    store.auditLog.push(event);
    if (store.auditLog.length > MAX_EVENTS) store.auditLog.splice(0, store.auditLog.length - MAX_EVENTS);
    return store;
  });
  return event;
}

export async function listAudit({ actorId, limit = 100 } = {}) {
  const store = await getStore();
  const events = Array.isArray(store.auditLog) ? store.auditLog : [];
  const filtered = actorId ? events.filter(item => item.actorId === actorId) : events;
  return filtered.slice(-Math.min(Math.max(Number(limit) || 100, 1), 500)).reverse();
}

export function auditInfo() {
  return { maxEvents: MAX_EVENTS, persistent: true };
}
