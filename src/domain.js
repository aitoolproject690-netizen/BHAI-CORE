import crypto from "node:crypto";
import { getStore, updateStore } from "./store.js";
import { listDnsChallenges } from "./dns.js";
import { healthCheck } from "./runtime.js";

const STATUSES = new Set(["pending", "active", "disabled"]);
const TLS_MODES = new Set(["managed", "manual"]);

function validHostname(hostname) {
  return typeof hostname === "string" &&
    hostname.length <= 253 &&
    /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(hostname);
}

function publicDomain(d) {
  return {
    id:d.id, ownerId:d.ownerId, serviceId:d.serviceId, hostname:d.hostname,
    status:d.status, tls:d.tls, routeId:d.routeId || null, createdAt:d.createdAt, updatedAt:d.updatedAt
  };
}

export async function createDomain({ ownerId, serviceId, hostname, tls = "managed" } = {}) {
  if (!ownerId || !serviceId || !validHostname(hostname))
    throw Object.assign(new Error("ownerId, serviceId and valid hostname required"), { code:"DOMAIN_FIELDS_REQUIRED", status:400 });
  const existing = await getStore();
  const service = existing.services?.[serviceId];
  if (!service || service.ownerId !== ownerId)
    throw Object.assign(new Error("Domain service ownership mismatch"), { code:"DOMAIN_SERVICE_FORBIDDEN", status:403 });
  if (!TLS_MODES.has(tls))
    throw Object.assign(new Error("Invalid TLS mode"), { code:"DOMAIN_TLS_INVALID", status:400 });
  const id = "dom_" + crypto.randomUUID();
  const now = new Date().toISOString();
  const domain = { id, ownerId, serviceId, hostname:hostname.toLowerCase(), status:"pending", tls, routeId:null, createdAt:now, updatedAt:now };
  await updateStore(store => { store.domains ??= {}; store.domains[id] = domain; return store; });
  return publicDomain(domain);
}

export async function getDomain(id, ownerId) {
  const store = await getStore();
  const d = store.domains?.[id];
  return d && d.ownerId === ownerId ? publicDomain(d) : null;
}

export async function listDomains(ownerId) {
  const store = await getStore();
  return Object.values(store.domains || {}).filter(d => d.ownerId === ownerId).map(publicDomain);
}

export async function setDomainStatus(id, ownerId, status) {
  if (!STATUSES.has(status))
    throw Object.assign(new Error("Invalid domain status"), { code:"DOMAIN_STATUS_INVALID", status:400 });
  if (status === "active") {
    const store = await getStore();
    const domain = store.domains?.[id];
    if (!domain || domain.ownerId !== ownerId) return null;
    const records = await listDnsChallenges(ownerId);
    const verified = records.some(r =>
      r.domainId === id &&
      r.status === "verified" &&
      String(r.hostname || "").toLowerCase().replace(/\.$/, "") === String(domain.hostname || "").toLowerCase().replace(/\.$/, "") &&
      String(r.name || "").toLowerCase().replace(/\.$/, "") === "_acme-challenge." + String(domain.hostname || "").toLowerCase().replace(/\.$/, "") &&
      r.type === "TXT"
    );
    if (!verified) throw Object.assign(new Error("Domain DNS verification required before activation"), { code:"DOMAIN_DNS_NOT_VERIFIED", status:409 });
    const service = store.services?.[domain.serviceId];
    if (!service || service.ownerId !== ownerId || service.status !== "running")
      throw Object.assign(new Error("Domain service is not ready"), { code:"DOMAIN_SERVICE_NOT_READY", status:409 });
    if (service.healthUrl) {
      const health = await healthCheck(service.healthUrl, { expectedPort: service.port });
      if (!health.ok)
        throw Object.assign(new Error("Domain service health check failed"), { code:"DOMAIN_SERVICE_UNHEALTHY", status:409 });
    }
  }
  let found = false;
  await updateStore(store => {
    const d = store.domains?.[id];
    if (!d || d.ownerId !== ownerId) return store;
    d.status = status;
    d.updatedAt = new Date().toISOString();
    found = true;
    return store;
  });
  return found ? getDomain(id, ownerId) : null;
}

export async function attachDomainRoute(id, ownerId, routeId) {
  if (!routeId) return null;
  const store = await getStore();
  const domain = store.domains?.[id];
  const route = store.routes?.[routeId];
  if (!domain || domain.ownerId !== ownerId) return null;
  if (!route || route.ownerId !== ownerId || route.serviceId !== domain.serviceId)
    throw Object.assign(new Error("Domain route ownership or service mismatch"), { code:"DOMAIN_ROUTE_FORBIDDEN", status:403 });
  let found = false;
  await updateStore(store => {
    const d = store.domains?.[id];
    if (!d || d.ownerId !== ownerId) return store;
    d.routeId = routeId;
    d.updatedAt = new Date().toISOString();
    found = true;
    return store;
  });
  return found ? getDomain(id, ownerId) : null;
}

export async function rebindDomainServices(fromServiceId, toServiceId, ownerId = null) {
  if (!toServiceId) return 0;
  let changed = 0;
  await updateStore(store => {
    for (const domain of Object.values(store.domains || {})) {
      if (
        domain.serviceId === fromServiceId &&
        (!ownerId || domain.ownerId === ownerId)
      ) {
        domain.serviceId = toServiceId;
        domain.updatedAt = new Date().toISOString();
        changed++;
      }
    }
    return store;
  });
  return changed;
}

export function domainInfo() {
  return { persistent:true, ownerScoped:true, statuses:[...STATUSES], tlsModes:[...TLS_MODES] };
}
