import crypto from "node:crypto";
import { getStore, updateStore } from "./store.js";

function inputHash(input) {
  return crypto.createHash("sha256").update(JSON.stringify(input ?? {})).digest("hex");
}

const APPROVAL_TTL_MS = Number(process.env.BHAI_APPROVAL_TTL_MS || 10 * 60 * 1000);

export async function createApproval({ actorId, tool, input, requestId } = {}) {
  const now = Date.now();
  const approval = {
    id: "approval_" + crypto.randomUUID(),
    actorId,
    tool,
    input,
    inputHash: inputHash(input),
    requestId,
    status: "pending",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + APPROVAL_TTL_MS).toISOString()
  };
  await updateStore(store => {
    store.approvals = store.approvals || {};
    store.approvals[approval.id] = approval;
    return store;
  });
  return approval;
}

export async function getApproval(id, actorId) {
  const store = await getStore();
  const item = store.approvals?.[id];
  return item && item.actorId === actorId ? item : null;
}

export async function decideApproval(id, actorId, decision) {
  const normalized = String(decision || "").toLowerCase();
  if (!["approved","rejected"].includes(normalized)) throw new Error("decision must be approved or rejected");
  let result = null;
  await updateStore(store => {
    const item = store.approvals?.[id];
    if (!item || item.actorId !== actorId) return store;
    if (item.status !== "pending") return store;
    if (Date.parse(item.expiresAt) <= Date.now()) {
      item.status = "expired";
      return store;
    }
    item.status = normalized;
    item.decidedAt = new Date().toISOString();
    result = structuredClone(item);
    return store;
  });
  return result;
}

export function approvalInfo() {
  return { ttlMs: APPROVAL_TTL_MS, statuses: ["pending","approved","rejected","expired"] };
}
