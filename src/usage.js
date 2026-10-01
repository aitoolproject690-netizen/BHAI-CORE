import { getStore, updateStore } from "./store.js";

const empty = () => ({ requests: 0, failures: 0, charsIn: 0, charsOut: 0 });

export async function recordUsage({ key = "anonymous", input = 0, output = 0, failed = false }) {
  let result;
  await updateStore(store => {
    const b = store.usage[key] || empty();
    b.requests += 1;
    b.charsIn += input;
    b.charsOut += output;
    if (failed) b.failures += 1;
    store.usage[key] = b;
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

export function resetUsage() {}
