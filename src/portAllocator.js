import { getStore, updateStore } from "./store.js";

const DEFAULT_START = 10000;
const DEFAULT_END = 20000;

function range() {
  const start = Number(process.env.BHAI_SERVICE_PORT_START || DEFAULT_START);
  const end = Number(process.env.BHAI_SERVICE_PORT_END || DEFAULT_END);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1024 || end > 65535 || start > end)
    throw Object.assign(new Error("Invalid service port range"), { code:"PORT_RANGE_INVALID", status:500 });
  return { start, end };
}

export async function allocatePort(preferredPort) {
  const preferred = preferredPort == null ? null : Number(preferredPort);
  let allocated;
  await updateStore(store => {
    const { start, end } = range();
    store.servicePorts ??= {};
    const used = new Set(Object.values(store.servicePorts).map(Number));
    if (preferred != null) {
      if (!Number.isInteger(preferred) || preferred < 1 || preferred > 65535)
        throw Object.assign(new Error("Invalid service port"), { code:"PORT_INVALID", status:400 });
      if (used.has(preferred))
        throw Object.assign(new Error("Service port already allocated"), { code:"PORT_IN_USE", status:409 });
      allocated = preferred;
    } else {
      for (let port = start; port <= end; port++) {
        if (!used.has(port)) { allocated = port; break; }
      }
      if (!allocated) throw Object.assign(new Error("No service ports available"), { code:"PORTS_EXHAUSTED", status:503 });
    }
    store.servicePorts["port_" + allocated] = allocated;
    return store;
  });
  return allocated;
}

export async function releasePort(port) {
  if (port == null) return false;
  let released = false;
  await updateStore(store => {
    const key = "port_" + Number(port);
    if (store.servicePorts?.[key] != null) { delete store.servicePorts[key]; released = true; }
    return store;
  });
  return released;
}

export function portInfo() {
  const { start, end } = range();
  return { persistent:true, range:{start,end}, allocation:"store_locked" };
}
