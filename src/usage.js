import { getStore, updateStore } from "./store.js";

const empty = () => ({ requests: 0, failures: 0, charsIn: 0, charsOut: 0 });

const emptyProvider = () => ({
  requests: 0,
  successes: 0,
  failures: 0,
  retries: 0,
  latencyMs: 0,
  lastLatencyMs: 0,
  lastStatus: "unknown",
  lastError: null,
  lastRequestAt: null
});

export async function recordUsage({ key = "anonymous", input = 0, output = 0, failed = false }) {
  let result;
  await updateStore(store => {
    const b = store.usage[key] || empty();
    b.requests += 1;
    b.charsIn += Number(input) || 0;
    b.charsOut += Number(output) || 0;
    if (failed) b.failures += 1;
    store.usage[key] = b;
    result = { ...b };
    return store;
  });
  return result;
}

export async function recordProviderUsage({
  provider,
  success,
  latencyMs = 0,
  retries = 0,
  error = null
}) {
  if (!provider) return null;
  let result;
  await updateStore(store => {
    store.providerUsage ??= {};
    const b = store.providerUsage[provider] || emptyProvider();
    b.requests += 1;
    if (success) b.successes += 1;
    else b.failures += 1;
    b.retries += Number(retries) || 0;
    b.latencyMs += Number(latencyMs) || 0;
    b.lastLatencyMs = Number(latencyMs) || 0;
    b.lastStatus = success ? "success" : "error";
    b.lastError = success ? null : String(error?.message || error || "Unknown error");
    b.lastRequestAt = new Date().toISOString();
    store.providerUsage[provider] = b;
    result = { ...b };
    return store;
  });
  return result;
}

export async function getUsage(key = "anonymous") {
  const store = await getStore();
  return { ...(store.usage[key] || empty()) };
}

export async function allUsage() {
  const store = await getStore();
  return Object.fromEntries(Object.entries(store.usage).map(([k, v]) => [k, { ...v }]));
}

export async function allProviderUsage() {
  const store = await getStore();
  return Object.fromEntries(
    Object.entries(store.providerUsage || {}).map(([k, v]) => [k, { ...v }])
  );
}

export function resetUsage() {}
