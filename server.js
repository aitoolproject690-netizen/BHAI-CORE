import http from "node:http";
import { config } from "./src/config.js";
import { generate, getProviderStatus } from "./src/router.js";
import { publicError } from "./src/errors.js";
import { requestId } from "./src/requestId.js";
import { recordUsage, allUsage, allProviderUsage } from "./src/usage.js";
import { assertBudget } from "./src/budget.js";
import { authenticate, createApiKey, listApiKeys, revokeApiKey } from "./src/auth.js";
import { health, readiness } from "./src/health.js";
import { enqueue, getStoredJob } from "./src/queue.js";
import { startSSE, sendEvent, endSSE } from "./src/stream.js";
import { EVENTS, tokenEvent, completeEvent, errorEvent } from "./src/events.js";
import { providerAdapters } from "./src/providers.js";
import { storageInfo } from "./src/store.js";
import { createTextFile, getFile, listFiles, deleteFile, searchFiles, fileLimits } from "./src/files.js";
import { canAttempt, recordFailure, recordSuccess } from "./src/circuitBreaker.js";
import { withRetry, classifyError } from "./src/retry.js";

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

    if (url.pathname === "/health" && req.method === "GET")
      return send(res, 200, { ...health(), storage: storageInfo() }, rid);

    if (url.pathname === "/ready" && req.method === "GET") {
      const result = readiness();
      return send(res, result.ready ? 200 : 503, result, rid);
    }

    if (!authorized(req))
      return send(res, 401, { ok: false, error: "Unauthorized" }, rid);

    if (url.pathname === "/v1/providers" && req.method === "GET")
      return send(res, 200, { ok: true, providers: getProviderStatus() }, rid);

    if (url.pathname === "/v1/usage" && req.method === "GET")
      return send(res, 200, { ok: true, usage: await allUsage() }, rid);

    if (url.pathname === "/v1/metrics" && req.method === "GET")
      return send(res, 200, {
        ok: true,
        providers: await allProviderUsage(),
        timestamp: new Date().toISOString()
      }, rid);

    if (url.pathname === "/v1/files" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, { ok: true, files: await listFiles(identity.id) }, rid);
    }

    if (url.pathname === "/v1/files" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req);
      const file = await createTextFile({
        ownerId: identity.id,
        name: body.name,
        text: body.text,
        mimeType: body.mimeType
      });
      return send(res, 201, { ok: true, file }, rid);
    }

    if (url.pathname === "/v1/files/search" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, {
        ok: true,
        results: await searchFiles(identity.id, url.searchParams.get("q"), url.searchParams.get("limit"))
      }, rid);
    }

    const fileMatch = url.pathname.match(/^\/v1\/files\/([^/]+)$/);
    if (fileMatch && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const file = await getFile(fileMatch[1], identity.id);
      return file ? send(res, 200, { ok: true, file }, rid) : send(res, 404, { ok: false, error: "File not found" }, rid);
    }

    if (fileMatch && req.method === "DELETE") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const deleted = await deleteFile(fileMatch[1], identity.id);
      return send(res, deleted ? 200 : 404, { ok: deleted }, rid);
    }

    if (url.pathname === "/v1/files/limits" && req.method === "GET")
      return send(res, 200, { ok: true, limits: fileLimits() }, rid);

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

    if (url.pathname === "/v1/jobs" && req.method === "POST") {
      const providedKey = req.headers["x-bhai-key"];
      if (!await authenticate(providedKey)) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req);
      return send(res, 202, await enqueue(body.type || "generic", body.payload || {}), rid);
    }

    const jobMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)$/);
    if (jobMatch && req.method === "GET") {
      const providedKey = req.headers["x-bhai-key"];
      if (!await authenticate(providedKey)) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const job = await getStoredJob(jobMatch[1]);
      return job ? send(res, 200, job, rid) : send(res, 404, { ok: false, error: "Job not found" }, rid);
    }

    if (url.pathname === "/v1/chat/completions/stream" && req.method === "POST") {
      const providedKey = req.headers["x-bhai-key"];
      const identity = await authenticate(providedKey);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);

      const body = await readJson(req);
      if (!Array.isArray(body.messages) || body.messages.length === 0)
        return send(res, 400, { ok: false, error: "messages must be a non-empty array" }, rid);

      const provider = String(body.provider || "").toLowerCase();
      const selected = provider || cfg.providerOrder.find(name => cfg.providers[name]?.key && providerAdapters[name + "Stream"]);
      const adapter = providerAdapters[selected + "Stream"];
      const providerCfg = cfg.providers[selected];
      const usageKey = identity.id;
      const inputChars = JSON.stringify(body).length;

      await assertBudget(usageKey, {
        maxRequests: process.env.BHAI_MAX_REQUESTS,
        maxInputChars: process.env.BHAI_MAX_INPUT_CHARS
      });

      if (!adapter || !providerCfg?.key)
        return send(res, 503, { ok: false, error: "No streaming provider is configured" }, rid);

      if (!canAttempt(selected))
        return send(res, 503, { ok: false, error: "Provider circuit is open", provider: selected }, rid);

      startSSE(res);
      sendEvent(res, { type: EVENTS.START, requestId: rid, provider: selected, model: providerCfg.model });

      const startedAt = Date.now();
      let emitted = false;
      let emittedChars = 0;
      let retries = 0;

      try {
        const result = await withRetry(
          async () => {
            try {
              return await adapter({
                ...providerCfg,
                messages: body.messages,
                temperature: body.temperature ?? 0.7,
                onToken: async token => {
                  emitted = true;
                  emittedChars += String(token ?? "").length;
                  sendEvent(res, tokenEvent(token));
                }
              });
            } catch (error) {
              if (emitted) {
                throw Object.assign(
                  new Error(error?.message || "Streaming failed after output started"),
                  { status: 400, code: "STREAM_PARTIAL_OUTPUT" }
                );
              }
              throw error;
            }
          },
          {
            retries: Number(process.env.BHAI_PROVIDER_RETRIES ?? 2),
            onRetry: () => { retries += 1; }
          }
        );

        const latencyMs = Date.now() - startedAt;
        recordSuccess(selected);
        await recordProviderUsage({
          provider: selected,
          success: true,
          latencyMs,
          retries
        });
        await recordUsage({
          key: usageKey,
          input: inputChars,
          output: String(result.text || "").length
        });

        sendEvent(res, completeEvent({
          provider: selected,
          model: providerCfg.model,
          attempts: retries + 1
        }));
        endSSE(res);
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        if (emitted) {
          error = Object.assign(new Error(error?.message || "Streaming failed after output started"), { status: 400 });
        }
        recordFailure(selected);
        await recordProviderUsage({
          provider: selected,
          success: false,
          latencyMs,
          retries,
          error
        });
        await recordUsage({
          key: usageKey,
          input: inputChars,
          output: emittedChars,
          failed: true
        });

        sendEvent(res, {
          ...errorEvent(error),
          kind: classifyError(error),
          retries
        });
        endSSE(res);
      }
      return;
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
