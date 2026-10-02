import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { getStore, updateStore } from "./store.js";
import { healthCheck } from "./runtime.js";

const ROUTE_STATUSES = new Set(["active", "disabled"]);
const HOP_BY_HOP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade"
]);

export function stripHopByHopHeaders(headers = {}) {
  const connectionTokens = String(headers.connection || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  const blocked = new Set([...HOP_BY_HOP_HEADERS, ...connectionTokens]);
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !blocked.has(String(name).toLowerCase()))
  );
}


function validPort(port) {
  const n = Number(port);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

function normalizeHost(hostname) {
  return String(hostname || "").trim().toLowerCase().replace(/:\d+$/, "");
}

function validHostname(host) {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
}

function publicRoute(r) {
  return { id:r.id, ownerId:r.ownerId, hostname:r.hostname, serviceId:r.serviceId, targetHost:r.targetHost, targetPort:r.targetPort, status:r.status, createdAt:r.createdAt, updatedAt:r.updatedAt };
}

export async function createRoute({ ownerId, hostname, serviceId, targetHost="127.0.0.1", targetPort } = {}) {
  const host = normalizeHost(hostname);
  if (!ownerId || !host || !serviceId || !validPort(targetPort))
    throw Object.assign(new Error("ownerId, hostname, serviceId and valid targetPort required"), { code:"ROUTE_FIELDS_REQUIRED", status:400 });
  const store = await getStore();
  const service = store.services?.[serviceId];
  if (!service || service.ownerId !== ownerId)
    throw Object.assign(new Error("Route service ownership mismatch"), { code:"ROUTE_SERVICE_FORBIDDEN", status:403 });
  if (!validHostname(host))
    throw Object.assign(new Error("Invalid route hostname"), { code:"ROUTE_HOST_INVALID", status:400 });
  if (validPort(service.port) && Number(targetPort) !== Number(service.port))
    throw Object.assign(new Error("Route target port must match service port"), { code:"ROUTE_TARGET_PORT_MISMATCH", status:409 });
  const upstreamHost = String(targetHost || "127.0.0.1").trim();
  if (!["127.0.0.1", "localhost", "::1"].includes(upstreamHost))
    throw Object.assign(new Error("Route target must be loopback"), { code:"ROUTE_TARGET_INVALID", status:400 });
  const existing = await findRouteByHostname(host);
  if (existing && existing.ownerId !== ownerId)
    throw Object.assign(new Error("Hostname is already owned"), { code:"ROUTE_HOST_CONFLICT", status:409 });
  if (existing)
    throw Object.assign(new Error("Hostname already routed"), { code:"ROUTE_EXISTS", status:409 });
  const id = "rte_" + crypto.randomUUID();
  const now = new Date().toISOString();
  const serviceReady = service.status === "running" && !service.healthUrl;
  const route = { id, ownerId, hostname:host, serviceId, targetHost:upstreamHost, targetPort:Number(targetPort), status:serviceReady ? "active" : "disabled", createdAt:now, updatedAt:now };
  await updateStore(store => { store.routes ??= {}; store.routes[id] = route; return store; });
  return publicRoute(route);
}

export async function getRoute(id, ownerId) {
  const store = await getStore();
  const r = store.routes?.[id];
  return r && r.ownerId === ownerId ? publicRoute(r) : null;
}

export async function listRoutes(ownerId) {
  const store = await getStore();
  return Object.values(store.routes || {}).filter(r => r.ownerId === ownerId).map(publicRoute);
}

export async function findRouteByHostname(hostname) {
  const host = normalizeHost(hostname);
  const store = await getStore();
  const r = Object.values(store.routes || {}).find(x => x.hostname === host && x.status === "active");
  return r ? publicRoute(r) : null;
}

export async function setServiceRouteStatus(serviceId, status) {
  if (!ROUTE_STATUSES.has(status))
    throw Object.assign(new Error("Invalid route status"), { code:"ROUTE_STATUS_INVALID", status:400 });
  let changed = 0;
  await updateStore(store => {
    for (const route of Object.values(store.routes || {})) {
      if (route.serviceId === serviceId && route.status !== status) {
        route.status = status;
        route.updatedAt = new Date().toISOString();
        changed++;
      }
    }
    return store;
  });
  return changed;
}

export async function rebindServiceRoutes(fromServiceId, toServiceId, targetPort, ownerId = null) {
  if (!toServiceId) return 0;
  if (!ownerId)
    throw Object.assign(new Error("Route rebind owner is required"), { code:"ROUTE_OWNER_REQUIRED", status:400 });
  const snapshot = await getStore();
  const targetService = snapshot.services?.[toServiceId];
  if (!targetService)
    throw Object.assign(new Error("Target route service not found"), { code:"ROUTE_SERVICE_NOT_FOUND", status:404 });
  if (ownerId && targetService.ownerId !== ownerId)
    throw Object.assign(new Error("Target route service ownership mismatch"), { code:"ROUTE_SERVICE_FORBIDDEN", status:403 });
  if (!validPort(targetService.port))
    throw Object.assign(new Error("Target route service has invalid port"), { code:"ROUTE_TARGET_PORT_INVALID", status:409 });
  if (targetPort != null && !validPort(targetPort))
    throw Object.assign(new Error("Invalid targetPort"), { code:"ROUTE_TARGET_PORT_INVALID", status:400 });
  const resolvedTargetPort = targetPort == null ? Number(targetService.port) : Number(targetPort);
  let changed = 0;
  await updateStore(store => {
    for (const route of Object.values(store.routes || {})) {
      if (
        (fromServiceId == null || route.serviceId === fromServiceId) &&
        route.ownerId &&
        (!ownerId || route.ownerId === ownerId) &&
        route.status === "active"
      ) {
        route.serviceId = toServiceId;
        route.targetPort = resolvedTargetPort;
        route.updatedAt = new Date().toISOString();
        changed++;
      }
    }
    return store;
  });
  return changed;
}

export async function setRouteStatus(id, ownerId, status) {
  if (!ROUTE_STATUSES.has(status))
    throw Object.assign(new Error("Invalid route status"), { code:"ROUTE_STATUS_INVALID", status:400 });
  if (status === "active") {
    const store = await getStore();
    const r = store.routes?.[id];
    if (!r || r.ownerId !== ownerId) return null;
    const service = store.services?.[r.serviceId];
    if (!service || service.ownerId !== ownerId)
      throw Object.assign(new Error("Route service ownership mismatch"), { code:"ROUTE_SERVICE_FORBIDDEN", status:403 });
    if (service.status !== "running")
      throw Object.assign(new Error("Route service is not ready"), { code:"ROUTE_SERVICE_NOT_READY", status:409 });
    if (service.healthUrl) {
      const health = await healthCheck(service.healthUrl, { expectedPort: service.port });
      if (!health.ok)
        throw Object.assign(new Error("Route service health check failed"), { code:"ROUTE_SERVICE_UNHEALTHY", status:409 });
    }
  }
  let found = false;
  await updateStore(store => {
    const r = store.routes?.[id];
    if (!r || r.ownerId !== ownerId) return store;
    r.status = status;
    r.updatedAt = new Date().toISOString();
    found = true;
    return store;
  });
  return found ? getRoute(id, ownerId) : null;
}

export function networkInfo() {
  return { persistent:true, ownerScoped:true, routing:"hostname_to_service", statuses:[...ROUTE_STATUSES], proxy:"http/https", rollbackRebind:true };
}

export function proxyRequest(req, res, route) {
  return new Promise(resolve => {
    const transport = process.env.BHAI_NETWORK_TLS === "true" ? https : http;
    const headers = stripHopByHopHeaders({ ...req.headers });
    delete headers["x-bhai-key"];
    delete headers["x-bhai-admin-key"];
    delete headers["x-bhai-route-id"];
    headers.host = route.targetHost + ":" + route.targetPort;
    headers["x-bhai-route-id"] = route.id;
    const upstream = transport.request({ hostname:route.targetHost, port:route.targetPort, method:req.method, path:req.url, headers, timeout:Number(process.env.BHAI_NETWORK_PROXY_TIMEOUT_MS || 15000) }, response => {
      res.writeHead(response.statusCode || 502, stripHopByHopHeaders(response.headers));
      response.pipe(res);
      response.on("end", resolve);
    });
    upstream.on("timeout", () => upstream.destroy(new Error("Upstream timeout")));
    upstream.on("error", () => {
      if (!res.headersSent) { res.writeHead(502, {"content-type":"application/json","cache-control":"no-store"}); res.end(JSON.stringify({ok:false,error:"Upstream service unavailable"})); }
      else res.destroy();
      resolve();
    });
    req.pipe(upstream);
  });
}
