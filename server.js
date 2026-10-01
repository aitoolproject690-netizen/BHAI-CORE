import http from "node:http";
import { config } from "./src/config.js";
import { generate, getProviderStatus } from "./src/router.js";
import { publicError } from "./src/errors.js";
import { requestId } from "./src/requestId.js";
import { recordUsage, allUsage } from "./src/usage.js";
import { assertBudget } from "./src/budget.js";
import { authenticate, createApiKey, listApiKeys, revokeApiKey } from "./src/auth.js";

const cfg = config();

function send(res, status, body, rid) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "x-request-id": rid
  });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  if (!cfg.apiKey) return true;
  return (req.headers.authorization || "") === "Bearer " + cfg.apiKey;
}

function adminAuthorized(req) {
  const expected = process.env.BHAI_CORE_ADMIN_KEY;
  return Boolean(expected && req.headers["x-bhai-admin-key"] === expected);
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2_000_000) throw new Error("Request body too large");
  }
  return body ? JSON.parse(body) : {};
}

const server = http.createServer(async (req, res) => {
  const rid = requestId(req);
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type, authorization, x-bhai-key, x-bhai-admin-key",
        "access-control-allow-methods": "GET,POST,DELETE,OPTIONS"
      });
      return res.end();
    }

    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

    if (url.pathname === "/health" && req.method === "GET") {
      return send(res, 200, {
        ok: true, service: "BHAI-CORE", version: "0.1.0",
        providers: getProviderStatus()
      }, rid);
    }

    if (!authorized(req)) return send(res, 401, { ok: false, error: "Unauthorized" }, rid);

    if (url.pathname === "/v1/providers" && req.method === "GET")
      return send(res, 200, { ok: true, providers: getProviderStatus() }, rid);

    if (url.pathname === "/v1/usage" && req.method === "GET")
      return send(res, 200, { ok: true, usage: await allUsage() }, rid);

    if (url.pathname === "/v1/keys" && req.method === "GET") {
      if (!adminAuthorized(req)) return send(res, 401, { ok: false, error: "Admin authentication required" }, rid);
      return send(res, 200, { ok: true, keys: await listApiKeys() }, rid);
    }

    if (url.pathname === "/v1/keys" && req.method === "POST") {
      if (!adminAuthorized(req)) return send(res, 401, { ok: false, error: "Admin authentication required" }, rid);
      const body = await readJson(req);
      return send(res, 201, { ok: true, ...(await createApiKey(body.name || "app")) }, rid);
    }

    if (url.pathname.startsWith("/v1/keys/") && req.method === "DELETE") {
      if (!adminAuthorized(req)) return send(res, 401, { ok: false, error: "Admin authentication required" }, rid);
      const id = url.pathname.split("/").pop();
      const revoked = await revokeApiKey(id);
      return send(res, revoked ? 200 : 404, { ok: revoked }, rid);
    }

    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      const providedKey = req.headers["x-bhai-key"];
      const identity = await authenticate(providedKey);
      const usageKey = identity?.id || providedKey || "anonymous";
      const body = await readJson(req);
      await assertBudget(usageKey);
      const result = await generate({
        messages: body.messages,
        provider: body.provider,
        temperature: body.temperature,
        maxAttempts: body.max_attempts
      });
      await recordUsage({
        key: usageKey,
        input: JSON.stringify(body).length,
        output: String(result.text || "").length
      });
      return send(res, 200, result, rid);
    }

    return send(res, 404, { ok: false, error: "Not found" }, rid);
  } catch (error) {
    await recordUsage({ key: req.headers["x-bhai-key"] || "anonymous", failed: true });
    return send(res, error.code === "BUDGET_EXCEEDED" ? 429 : 500, {
      ok: false, ...publicError(error), requestId: rid
    }, rid);
  }
});

server.listen(cfg.port, cfg.host, () =>
  console.log("BHAI-CORE listening on http://" + cfg.host + ":" + cfg.port)
);
