import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const DEFAULT_HOST = "::";
export const DEFAULT_PORT = 19180;
export const MAX_BODY = 192 * 1024;
export const MAX_CONCURRENT = 4;
export const RATE_LIMIT = 60;
export const RATE_WINDOW_MS = 60_000;
export const REQUEST_TIMEOUT_MS = 65_000;

const ALLOWED = new Map([
  ["GET /v1/models", true],
  ["POST /v1/chat/completions", true],
  ["POST /v1/image/generate", true],
  ["GET /v1/image/jobs/:id", true],
  ["POST /v1/video/generate", true],
  ["GET /v1/video/jobs/:id", true]
]);

function boolEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ""));
}

function cleanPath(path) {
  const value = String(path || "");
  return value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function readSecret({ value, file, fallbackFile }) {
  if (String(value || "").trim()) return String(value).trim();
  const filePath = String(file || fallbackFile || "").trim();
  if (!filePath) return "";
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

function localEngineUrl(value) {
  const raw = String(value || "http://127.0.0.1:18080").trim().replace(/\/+$/, "");
  let url;
  try { url = new URL(raw); } catch { throw new Error("Invalid BHAI_LOCAL_ENGINE_URL"); }
  const loopback = url.hostname === "127.0.0.1"
    || url.hostname === "localhost"
    || url.hostname === "[::1]"
    || url.hostname === "::1";
  if (!loopback || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("BHAI_LOCAL_ENGINE_URL must point to loopback HTTP(S)");
  }
  return raw;
}

function requestAllowed(method, path) {
  const normalized = String(method || "GET").toUpperCase() + " " + cleanPath(path);
  if (ALLOWED.has(normalized)) return true;
  return /^(GET|POST) \/v1\/(?:image|video)\/jobs\/[A-Za-z0-9._:-]{1,160}$/.test(normalized)
    || /^POST \/v1\/(?:image|video)\/generate$/.test(normalized);
}

async function readBody(req) {
  const length = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(length) && length > MAX_BODY) {
    throw Object.assign(new Error("request body too large"), { status: 413 });
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += Buffer.byteLength(chunk);
    if (total > MAX_BODY) {
      throw Object.assign(new Error("request body too large"), { status: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function publicHeaders(input = {}) {
  const output = { "content-type": String(input["content-type"] || "application/json") };
  if (input["cache-control"]) output["cache-control"] = String(input["cache-control"]);
  if (String(output["content-type"]).includes("text/event-stream")) {
    output["cache-control"] = "no-cache";
    output["x-accel-buffering"] = "no";
  }
  return output;
}

export function createMobileGateway(options = {}) {
  const host = String(options.host ?? process.env.BHAI_MOBILE_GATEWAY_HOST ?? DEFAULT_HOST);
  const port = Number(options.port ?? process.env.BHAI_MOBILE_GATEWAY_PORT ?? DEFAULT_PORT);
  const tls = Boolean(options.tls ?? boolEnv(process.env.BHAI_MOBILE_GATEWAY_TLS));
  const engineUrl = localEngineUrl(options.engineUrl ?? process.env.BHAI_LOCAL_ENGINE_URL);
  const token = readSecret({
    value: options.token ?? process.env.BHAI_MOBILE_GATEWAY_TOKEN,
    file: options.tokenFile ?? process.env.BHAI_MOBILE_GATEWAY_TOKEN_FILE,
    fallbackFile: process.env.HOME ? `${process.env.HOME}/.config/bhai/mobile-gateway-key` : ""
  });
  const engineKey = readSecret({
    value: options.engineKey ?? process.env.BHAI_LOCAL_ENGINE_KEY,
    file: options.engineKeyFile ?? process.env.BHAI_LOCAL_ENGINE_KEY_FILE,
    fallbackFile: process.env.HOME ? `${process.env.HOME}/.config/bhai/engine-key` : ""
  });
  const certFile = String(options.certFile ?? process.env.BHAI_MOBILE_GATEWAY_TLS_CERT_FILE ?? "").trim();
  const keyFile = String(options.keyFile ?? process.env.BHAI_MOBILE_GATEWAY_TLS_KEY_FILE ?? "").trim();
  const maxConcurrent = Number(options.maxConcurrent ?? MAX_CONCURRENT);
  const requests = new Map();
  let active = 0;

  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid BHAI_MOBILE_GATEWAY_PORT");
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 32) throw new Error("Invalid max concurrency");
  if (tls && (!certFile || !keyFile)) throw new Error("TLS requires certificate and key files");
  const tlsFingerprint = tls
    ? new crypto.X509Certificate(fs.readFileSync(certFile)).fingerprint256
    : "";

  const handler = async (req, res) => {
    const path = cleanPath(new URL(req.url || "/", "http://gateway.local").pathname);
    const method = String(req.method || "GET").toUpperCase();

    if (method === "GET" && path === "/health") {
      const protocol = tls ? "https" : "http";
      return json(res, 200, {
        ok: true,
        service: "BHAI-MOBILE-GATEWAY",
        configured: Boolean(token && engineKey),
        protocol,
        host,
        port,
        tls_fingerprint: tlsFingerprint || undefined
      });
    }

    if (!requestAllowed(method, path)) return json(res, 404, { ok: false, error: "not_found" });
    if (!token || !engineKey) return json(res, 503, { ok: false, error: "gateway_not_configured" });

    const auth = String(req.headers.authorization || "");
    if (!safeEqual(auth, "Bearer " + token)) return json(res, 401, { ok: false, error: "authentication_required" });

    const client = String(req.socket.remoteAddress || "unknown");
    const now = Date.now();
    let bucket = requests.get(client);
    if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
      bucket = { startedAt: now, count: 0 };
      requests.set(client, bucket);
    }
    bucket.count += 1;
    if (bucket.count > RATE_LIMIT) return json(res, 429, { ok: false, error: "rate_limit" });
    if (requests.size > 1024) {
      for (const [key, value] of requests) {
        if (now - value.startedAt >= RATE_WINDOW_MS) requests.delete(key);
      }
    }

    if (active >= maxConcurrent) return json(res, 429, { ok: false, error: "gateway_busy" });
    active += 1;
    try {
      const body = method === "GET" ? null : await readBody(req);
      const forwarded = await callEngine({ method, path, body, engineUrl, engineKey });
      res.statusCode = forwarded.status;
      for (const [key, value] of Object.entries(publicHeaders(forwarded.headers))) res.setHeader(key, value);

      if (!forwarded.response.body) {
        const text = await forwarded.response.text();
        if (Buffer.byteLength(text) > MAX_BODY) return json(res, 502, { ok: false, error: "engine_response_too_large" });
        res.end(text);
        return;
      }

      const limiter = new Transform({
        transform(chunk, encoding, callback) {
          this.total = (this.total || 0) + Buffer.byteLength(chunk);
          if (this.total > MAX_BODY) {
            callback(Object.assign(new Error("engine_response_too_large"), { status: 502 }));
            return;
          }
          callback(null, chunk);
        }
      });
      try {
        await pipeline(Readable.fromWeb(forwarded.response.body), limiter, res);
      } catch (error) {
        if (!res.headersSent) json(res, 502, { ok: false, error: error.message });
        else res.destroy(error);
      }
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error);
      } else {
        const status = Number(error?.status) >= 400 ? Number(error.status) : 502;
        return json(res, status, { ok: false, error: String(error?.message || "gateway_error") });
      }
    } finally {
      active -= 1;
    }
  };

  const server = tls
    ? https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), minVersion: "TLSv1.2" }, handler)
    : http.createServer(handler);

  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 10_000;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.maxConnections = 64;

  return {
    server,
    config: { host, port, tls, engineUrl, configured: Boolean(token && engineKey) },
    start() {
      return new Promise((resolveStart, reject) => {
        const onError = error => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolveStart(server.address());
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen({ host, port, ipv6Only: host === "::" });
      });
    },
    stop() {
      return new Promise(resolveStop => server.close(() => resolveStop()));
    }
  };
}

async function callEngine({ method, path, body, engineUrl, engineKey }) {
  const base = engineUrl.replace(/\/+$/, "");
  const target = base + cleanPath(path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers = { "content-type": "application/json", authorization: "Bearer " + engineKey };
    const response = await fetch(target, {
      method,
      headers,
      body: body ?? undefined,
      signal: controller.signal
    });
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()), response };
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error("local engine request timed out"), { status: 504 });
    throw Object.assign(new Error("local engine unavailable: " + String(error?.message || error).slice(0, 200)), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  try {
    const gateway = createMobileGateway();
    const address = await gateway.start();
    const shown = typeof address === "object" && address
      ? `${address.address}:${address.port}`
      : String(address);
    console.log(`BHAI-MOBILE-GATEWAY listening on ${shown}`);
  } catch (error) {
    console.error("BHAI-MOBILE-GATEWAY failed to start:", error?.message || error);
    process.exitCode = 1;
  }
}
