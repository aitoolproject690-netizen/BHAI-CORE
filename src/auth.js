import crypto from "node:crypto";
import { getStore, updateStore } from "./store.js";

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function createApiKey(name = "default") {
  const raw = "bhai_" + crypto.randomBytes(24).toString("base64url");
  const id = hash(raw).slice(0, 16);
  await updateStore(store => {
    store.apiKeys[id] = {
      id, name, hash: hash(raw),
      createdAt: new Date().toISOString(), active: true
    };
    return store;
  });
  return { id, key: raw, name };
}

export async function revokeApiKey(id) {
  let found = false;
  await updateStore(store => {
    if (!store.apiKeys[id]) return store;
    store.apiKeys[id].active = false;
    found = true;
    return store;
  });
  return found;
}

export async function authenticate(value) {
  if (!value) return null;
  const digest = hash(value);
  const store = await getStore();
  for (const item of Object.values(store.apiKeys)) {
    if (item.active && item.hash === digest) return { id: item.id, name: item.name };
  }
  return null;
}

export async function listApiKeys() {
  const store = await getStore();
  return Object.values(store.apiKeys).map(({ hash, ...safe }) => safe);
}

export function resetApiKeys() {}
