import fs from "node:fs/promises";
import path from "node:path";

const file = process.env.BHAI_STORE_FILE || "./data/bhai-core-store.json";
let state = { apiKeys: {}, usage: {}, jobs: {} };
let loaded = false;
let writeChain = Promise.resolve();

async function ensureLoaded() {
  if (loaded) return;
  try {
    state = JSON.parse(await fs.readFile(file, "utf8"));
    state.apiKeys ??= {};
    state.usage ??= {};
    state.jobs ??= {};
  } catch {
    state = { apiKeys: {}, usage: {}, jobs: {} };
  }
  loaded = true;
}

async function persist(snapshot) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export async function getStore() {
  await ensureLoaded();
  return state;
}

export async function saveStore(next) {
  await ensureLoaded();
  const snapshot = structuredClone(next);
  writeChain = writeChain.then(async () => {
    state = snapshot;
    await persist(state);
  });
  await writeChain;
  return state;
}

export async function updateStore(mutator) {
  await ensureLoaded();
  let result;
  writeChain = writeChain.then(async () => {
    const next = await mutator(state);
    state = next || state;
    await persist(state);
    result = state;
  });
  await writeChain;
  return result;
}

export function resetStoreForTests() {
  state = { apiKeys: {}, usage: {}, jobs: {} };
  loaded = true;
  writeChain = Promise.resolve();
}
