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
  billing: {},
  jobs: {},
  imageJobs: {},
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

  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      state = emptyState();
      loaded = true;
      return;
    }
    throw Object.assign(new Error("Persistent store could not be read"), {
      code: "STORE_READ_FAILED",
      status: 500,
      cause: error
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw Object.assign(new Error("Persistent store contains invalid JSON"), {
      code: "STORE_CORRUPT",
      status: 500,
      cause: error
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("Persistent store must contain a JSON object"), {
      code: "STORE_CORRUPT",
      status: 500
    });
  }

  const collectionNames = [
    "apiKeys", "usage", "providerUsage", "billing", "jobs", "imageJobs", "files", "ragChunks",
    "approvals", "services", "deployments", "servicePorts", "routes",
    "domains", "autoDeploy", "certificates", "acmeAccounts", "acmeOrders",
    "dnsRecords"
  ];
  for (const name of collectionNames) {
    if (parsed[name] != null && (!parsed[name] || typeof parsed[name] !== "object" || Array.isArray(parsed[name]))) {
      throw Object.assign(new Error(`Persistent store field ${name} must be a JSON object`), {
        code: "STORE_CORRUPT",
        status: 500
      });
    }
  }
  if (parsed.auditLog != null && !Array.isArray(parsed.auditLog)) {
    throw Object.assign(new Error("Persistent store field auditLog must be a JSON array"), {
      code: "STORE_CORRUPT",
      status: 500
    });
  }

  state = {
    ...emptyState(),
    ...parsed,
    apiKeys: parsed.apiKeys ?? {},
    usage: parsed.usage ?? {},
    providerUsage: parsed.providerUsage ?? {},
    billing: parsed.billing ?? {},
    jobs: parsed.jobs ?? {},
    imageJobs: parsed.imageJobs ?? {},
    files: parsed.files ?? {},
    ragChunks: parsed.ragChunks ?? {},
    auditLog: parsed.auditLog ?? [],
    approvals: parsed.approvals ?? {},
    services: parsed.services ?? {},
    deployments: parsed.deployments ?? {},
    servicePorts: parsed.servicePorts ?? {},
    routes: parsed.routes ?? {},
    domains: parsed.domains ?? {},
    autoDeploy: parsed.autoDeploy ?? {},
    certificates: parsed.certificates ?? {},
    acmeAccounts: parsed.acmeAccounts ?? {},
    acmeOrders: parsed.acmeOrders ?? {},
    dnsRecords: parsed.dnsRecords ?? {}
  };
  loaded = true;
}

async function persist(snapshot) {
  const serialized = JSON.stringify(snapshot, null, 2);
  const size = Buffer.byteLength(serialized, "utf8");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) throw new Error("Invalid BHAI_STORE_MAX_BYTES configuration");
  if (size > maxBytes) throw Object.assign(new Error("Persistent store size limit exceeded"), { code:"STORE_SIZE_LIMIT", status:507, size, maxBytes });
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, serialized, { encoding:"utf8", mode:0o600 });
    if (backupEnabled) {
      try { await fs.copyFile(file, `${file}.bak`); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    await fs.rename(tmp, file);
    try { await fs.chmod(file, 0o600); } catch {}
  } finally {
    try { await fs.unlink(tmp); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
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
