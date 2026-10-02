import crypto from "node:crypto";
import { getStore, updateStore } from "./store.js";

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function createApiKey(name = "default", scopes, limits = {}) {
  const raw = "bhai_" + crypto.randomBytes(24).toString("base64url");
  const id = hash(raw).slice(0, 16);
  const cleanScopes = Array.isArray(scopes) && scopes.length ? [...new Set(scopes.map(String))] : undefined;
  const maxRequests = Number(limits.maxRequests);
  const maxInputChars = Number(limits.maxInputChars);
  const cleanLimits = {
    ...(Number.isSafeInteger(maxRequests) && maxRequests > 0 ? { maxRequests } : {}),
    ...(Number.isSafeInteger(maxInputChars) && maxInputChars > 0 ? { maxInputChars } : {})
  };
  await updateStore(store => {
    store.apiKeys[id] = {
      id, name: String(name || "default").slice(0, 120), hash: hash(raw),
      createdAt: new Date().toISOString(), active: true,
      scopes: cleanScopes,
      limits: cleanLimits
    };
    return store;
  });
  return { id, key: raw, name: String(name || "default").slice(0, 120), limits: cleanLimits, scopes: cleanScopes };
}

export async function revokeApiKey(id) {
  let found = false;
  await updateStore(store => {
    if (!store.apiKeys[id]) return store;
    store.apiKeys[id].active = false;
    store.apiKeys[id].revokedAt = new Date().toISOString();
    found = true;
    return store;
  });
  return found;
}

export async function rotateApiKey(id) {
  const raw = "bhai_" + crypto.randomBytes(24).toString("base64url");
  const newId = hash(raw).slice(0, 16);
  let result = null;
  await updateStore(store => {
    const current = store.apiKeys[id];
    if (!current || !current.active) return store;
    current.active = false;
    current.revokedAt = new Date().toISOString();
    store.apiKeys[newId] = {
      ...current, id: newId, hash: hash(raw),
      createdAt: new Date().toISOString(), revokedAt: undefined,
      active: true, rotatedFrom: id
    };
    result = { id: newId, key: raw, name: current.name, scopes: current.scopes, limits: current.limits || {} };
    return store;
  });
  return result;
}

function hashesEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function authenticate(value) {
  if (!value) return null;
  const digest = hash(value);
  const store = await getStore();
  for (const item of Object.values(store.apiKeys)) {
    if (item.active && hashesEqual(item.hash, digest)) return { id: item.id, name: item.name, scopes: item.scopes, limits: item.limits || {} };
  }
  return null;
}

export async function listApiKeys() {
  const store = await getStore();
  return Object.values(store.apiKeys).map(({ hash, ...safe }) => safe);
}

export function resetApiKeys() {}
