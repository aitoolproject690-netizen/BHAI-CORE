import crypto from "node:crypto";

const keys = new Map();

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createApiKey(name = "default") {
  const raw = "bhai_" + crypto.randomBytes(24).toString("base64url");
  const id = hash(raw).slice(0, 16);
  keys.set(id, { id, name, hash: hash(raw), createdAt: new Date().toISOString(), active: true });
  return { id, key: raw, name };
}

export function revokeApiKey(id) {
  const item = keys.get(id);
  if (!item) return false;
  item.active = false;
  return true;
}

export function authenticate(value) {
  if (!value) return null;
  const digest = hash(value);
  for (const item of keys.values()) {
    if (item.active && item.hash === digest) return { id: item.id, name: item.name };
  }
  return null;
}

export function listApiKeys() {
  return [...keys.values()].map(({ hash, ...safe }) => safe);
}

export function resetApiKeys() {
  keys.clear();
}
