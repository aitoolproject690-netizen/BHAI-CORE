import fs from "node:fs/promises";
import path from "node:path";

const file = process.env.BHAI_STORE_FILE || "./data/bhai-core-store.json";
let state = { apiKeys: {}, usage: {} };
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  try {
    state = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    state = { apiKeys: {}, usage: {} };
  }
  loaded = true;
}

async function persist() {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export async function getStore() {
  await ensureLoaded();
  return state;
}

export async function saveStore(next) {
  await ensureLoaded();
  state = next;
  await persist();
  return state;
}

export async function updateStore(mutator) {
  await ensureLoaded();
  const next = await mutator(state);
  state = next || state;
  await persist();
  return state;
}

export function resetStoreForTests() {
  state = { apiKeys: {}, usage: {} };
  loaded = true;
}
