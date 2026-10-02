import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const file = process.env.BHAI_STORE_FILE || "./data/bhai-core-store.json";
const maxBytes = Number(process.env.BHAI_STORE_MAX_BYTES || 10 * 1024 * 1024);
const backupEnabled = process.env.BHAI_STORE_BACKUP !== "false";

const emptyState = () => ({
  apiKeys: {},
  usage: {},
  providerUsage: {},
  jobs: {},
  files: {},
  ragChunks: {},
  auditLog: [],
  approvals: {},
    services: {},
  deployments: {},
  servicePorts: {},
  routes: {},
  domains: {},
  autoDeploy: {},
  certificates: {},
  acmeAccounts: {},
  acmeOrders: {},
  dnsRecords: {}
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
      files: parsed.files ?? {},
      ragChunks: parsed.ragChunks ?? {},
      auditLog: parsed.auditLog ?? [],
      approvals: parsed.approvals,
    services: parsed.services || {},
    deployments: parsed.deployments || {},
      servicePorts: parsed.servicePorts || {},
      routes: parsed.routes || {},
      domains: parsed.domains || {},
      autoDeploy: parsed.autoDeploy || {},
      certificates: parsed.certificates || {},
      acmeAccounts: parsed.acmeAccounts || {},
      acmeOrders: parsed.acmeOrders || {},
      dnsRecords: parsed.dnsRecords || {}
    };
  } catch {
    state = emptyState();
  }

  loaded = true;
}

async function persist(snapshot) {
  const serialized = JSON.stringify(snapshot, null, 2);
  const size = Buffer.byteLength(serialized, "utf8");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) throw new Error("Invalid BHAI_STORE_MAX_BYTES configuration");
  if (size > maxBytes) throw Object.assign(new Error("Persistent store size limit exceeded"), { code:"STORE_SIZE_LIMIT", status:507, size, maxBytes });
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, serialized, { encoding:"utf8", mode:0o600 });
  if (backupEnabled) {
    try { await fs.copyFile(file, `${file}.bak`); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  await fs.rename(tmp, file);
  try { await fs.chmod(file, 0o600); } catch {}
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
    persistent: true,
    maxBytes,
    backupEnabled
  };
}

export function resetStoreForTests() {
  state = emptyState();
  loaded = true;
  writeChain = Promise.resolve();
}
