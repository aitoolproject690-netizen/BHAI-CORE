import fs from "node:fs/promises";
import path from "node:path";

const file = process.env.BHAI_STORE_FILE || "./data/bhai-core-store.json";

const emptyState = () => ({
  apiKeys: {},
  usage: {},
  providerUsage: {},
  jobs: {},
  files: {}
});

let state = emptyState();
let loaded = false;
let writeChain = Promise.resolve();

async function ensureLoaded() {
  if (loaded) return;

  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    state = {
      ...emptyState(),
      ...parsed,
      apiKeys: parsed.apiKeys ?? {},
      usage: parsed.usage ?? {},
      providerUsage: parsed.providerUsage ?? {},
      jobs: parsed.jobs ?? {},
      files: parsed.files ?? {}
    };
  } catch {
    state = emptyState();
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
  await updateStore(() => structuredClone(next));
  return state;
}

export async function updateStore(mutator) {
  await ensureLoaded();

  let result;
  const operation = writeChain.then(async () => {
    const working = structuredClone(state);
    const next = await mutator(working);
    state = next || working;
    await persist(state);
    result = state;
  });

  writeChain = operation.catch(() => {});
  await operation;
  return result;
}

export function storageInfo() {
  return {
    backend: "json",
    file,
    persistent: true
  };
}

export function resetStoreForTests() {
  state = emptyState();
  loaded = true;
  writeChain = Promise.resolve();
}
