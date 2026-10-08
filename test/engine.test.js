import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { generate, getProviderStatus, isProviderConfigured } from "../src/router.js";
import { providerAdapters } from "../src/providers.js";

test("BHAI engine is a first-class provider without requiring a vendor API key", async () => {
  const previousOrder = process.env.AI_PROVIDER_ORDER;
  const previousUrl = process.env.BHAI_ENGINE_URL;
  const previousModel = process.env.BHAI_ENGINE_MODEL;
  const previousKey = process.env.BHAI_ENGINE_API_KEY;
  const previousAdapter = providerAdapters.engine;

  process.env.AI_PROVIDER_ORDER = "engine";
  process.env.BHAI_ENGINE_URL = "http://engine.test";
  process.env.BHAI_ENGINE_MODEL = "bhai-local";
  delete process.env.BHAI_ENGINE_API_KEY;
  providerAdapters.engine = async ({ url, model, messages }) => ({
    text: messages[0].content,
    raw: { url, model }
  });

  try {
    assert.equal(isProviderConfigured("engine"), true);
    const status = getProviderStatus();
    assert.equal(status.engine.configured, true);
    assert.equal(status.engine.model, "bhai-local");

    const result = await generate({
      messages: [{ role: "user", content: "hello bhai" }]
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "engine");
    assert.equal(result.model, "bhai-local");
    assert.equal(result.text, "hello bhai");
  } finally {
    providerAdapters.engine = previousAdapter;
    if (previousOrder === undefined) delete process.env.AI_PROVIDER_ORDER;
    else process.env.AI_PROVIDER_ORDER = previousOrder;
    if (previousUrl === undefined) delete process.env.BHAI_ENGINE_URL;
    else process.env.BHAI_ENGINE_URL = previousUrl;
    if (previousModel === undefined) delete process.env.BHAI_ENGINE_MODEL;
    else process.env.BHAI_ENGINE_MODEL = previousModel;
    if (previousKey === undefined) delete process.env.BHAI_ENGINE_API_KEY;
    else process.env.BHAI_ENGINE_API_KEY = previousKey;
  }
});


test("engine provider can remain configured with only a fallback target", async () => {
  const previousOrder = process.env.AI_PROVIDER_ORDER;
  const previousUrl = process.env.BHAI_ENGINE_URL;
  const previousModel = process.env.BHAI_ENGINE_MODEL;
  const previousFallbackUrl = process.env.BHAI_ENGINE_FALLBACK_URL;
  const previousFallbackModel = process.env.BHAI_ENGINE_FALLBACK_MODEL;
  const previousKey = process.env.BHAI_ENGINE_API_KEY;
  const previousFallbackKey = process.env.BHAI_ENGINE_FALLBACK_API_KEY;
  const previousAdapter = providerAdapters.engine;

  process.env.AI_PROVIDER_ORDER = "engine";
  delete process.env.BHAI_ENGINE_URL;
  process.env.BHAI_ENGINE_MODEL = "phone-model";
  process.env.BHAI_ENGINE_FALLBACK_URL = "http://fallback.test";
  process.env.BHAI_ENGINE_FALLBACK_MODEL = "fallback-model";
  delete process.env.BHAI_ENGINE_API_KEY;
  process.env.BHAI_ENGINE_FALLBACK_API_KEY = "fallback-secret";
  providerAdapters.engine = async ({ url, fallbackUrl, model }) => ({
    text: "fallback ok",
    raw: { url, fallbackUrl, model }
  });

  try {
    assert.equal(isProviderConfigured("engine"), true);
    const result = await generate({ messages: [{ role: "user", content: "hello" }] });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "engine");
    assert.equal(result.text, "fallback ok");
  } finally {
    providerAdapters.engine = previousAdapter;
    if (previousOrder === undefined) delete process.env.AI_PROVIDER_ORDER; else process.env.AI_PROVIDER_ORDER = previousOrder;
    if (previousUrl === undefined) delete process.env.BHAI_ENGINE_URL; else process.env.BHAI_ENGINE_URL = previousUrl;
    if (previousModel === undefined) delete process.env.BHAI_ENGINE_MODEL; else process.env.BHAI_ENGINE_MODEL = previousModel;
    if (previousFallbackUrl === undefined) delete process.env.BHAI_ENGINE_FALLBACK_URL; else process.env.BHAI_ENGINE_FALLBACK_URL = previousFallbackUrl;
    if (previousFallbackModel === undefined) delete process.env.BHAI_ENGINE_FALLBACK_MODEL; else process.env.BHAI_ENGINE_FALLBACK_MODEL = previousFallbackModel;
    if (previousKey === undefined) delete process.env.BHAI_ENGINE_API_KEY; else process.env.BHAI_ENGINE_API_KEY = previousKey;
    if (previousFallbackKey === undefined) delete process.env.BHAI_ENGINE_FALLBACK_API_KEY; else process.env.BHAI_ENGINE_FALLBACK_API_KEY = previousFallbackKey;
  }
});


test("engine can pin a self-signed HTTPS phone gateway by certificate fingerprint", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bhai-engine-tls-"));
  const keyFile = path.join(tmp, "key.pem");
  const certFile = path.join(tmp, "cert.pem");

  execFileSync("openssl", [
    "req", "-x509", "-new", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyFile, "-out", certFile, "-days", "1",
    "-subj", "/CN=bhai-test-gateway"
  ], { stdio: "ignore" });

  const cert = new crypto.X509Certificate(fs.readFileSync(certFile));
  const fingerprint = cert.fingerprint256.replace(/:/g, "").toLowerCase();

  const server = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, (req, res) => {
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ data: [{ id: "smollm2.gguf" }] }));
    }
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;
  try {
    const { bhaiEngineProbe } = await import("../src/engine.js");
    const ok = await bhaiEngineProbe({
      url: `https://127.0.0.1:${port}`,
      key: "ignored-by-test-server",
      model: "smollm2.gguf",
      tlsFingerprint: fingerprint
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.model_available, true);

    await assert.rejects(
      () => bhaiEngineProbe({
        url: `https://127.0.0.1:${port}`,
        key: "ignored-by-test-server",
        model: "smollm2.gguf",
        tlsFingerprint: "00".repeat(32)
      }),
      /fingerprint mismatch|All BHAI engine targets failed/
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test("engine accepts compatible response text shapes", async () => {
  const { bhaiEngineChat } = await import("../src/engine.js");
  const cases = [
    [{ choices: [{ message: { content: "message-content" } }] }, "message-content"],
    [{ choices: [{ message: { text: "message-text" } }] }, "message-text"],
    [{ choices: [{ text: "choice-text" }] }, "choice-text"],
    [{ output_text: "output-text" }, "output-text"],
    [{ response: "response-text" }, "response-text"]
  ];
  for (const [body, expected] of cases) {
    const server = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const port = server.address().port;
      const result = await bhaiEngineChat({
        url: "http://127.0.0.1:" + port,
        model: "test-model",
        messages: [{ role: "user", content: "hello" }]
      });
      assert.equal(result.text, expected);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test("engine supports multiple comma-separated fallback targets", async () => {
  const { engineTargets } = await import("../src/engine.js");
  const targets = engineTargets({
    url: "https://primary.test",
    model: "smollm2.gguf",
    fallbackUrl: "mobile://node, mobile://relay",
    fallbackModel: "smollm2.gguf"
  });
  assert.deepEqual(targets.map(target => ({ url: target.url, role: target.role, model: target.model })), [
    { url: "https://primary.test", role: "primary", model: "smollm2.gguf" },
    { url: "mobile://node", role: "fallback", model: "smollm2.gguf" },
    { url: "mobile://relay", role: "fallback", model: "smollm2.gguf" }
  ]);
});


test("engine auto-routes to a ready mobile chat engine", async () => {
  const { updateMobileEngineRegistry } = await import("../src/mobileEngines.js");
  const { generate, getProviderStatus, isProviderConfigured } = await import("../src/router.js");
  const { providerAdapters } = await import("../src/providers.js");

  const previousOrder = process.env.AI_PROVIDER_ORDER;
  const previousUrl = process.env.BHAI_ENGINE_URL;
  const previousFallbackUrl = process.env.BHAI_ENGINE_FALLBACK_URL;
  const previousAdapter = providerAdapters.engine;

  process.env.AI_PROVIDER_ORDER = "engine";
  delete process.env.BHAI_ENGINE_URL;
  delete process.env.BHAI_ENGINE_FALLBACK_URL;

  updateMobileEngineRegistry([
    {
      id: "smollm2",
      name: "SmolLM2",
      kind: "llm",
      model: "smollm2.gguf",
      backend: "llama.cpp-vulkan",
      capabilities: ["chat", "gpu"],
      ready: true,
      loaded: true,
      memory_mb: 512
    }
  ]);

  providerAdapters.engine = async ({ url, model, messages }) => ({
    text: messages[0].content,
    raw: { url, model }
  });

  try {
    assert.equal(isProviderConfigured("engine"), true);
    assert.equal(getProviderStatus().engine.model, "smollm2.gguf");

    const result = await generate({
      messages: [{ role: "user", content: "hello mobile" }]
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "engine");
    assert.equal(result.model, "smollm2.gguf");
    assert.equal(result.text, "hello mobile");
  } finally {
    updateMobileEngineRegistry([]);
    providerAdapters.engine = previousAdapter;
    if (previousOrder === undefined) delete process.env.AI_PROVIDER_ORDER;
    else process.env.AI_PROVIDER_ORDER = previousOrder;
    if (previousUrl === undefined) delete process.env.BHAI_ENGINE_URL;
    else process.env.BHAI_ENGINE_URL = previousUrl;
    if (previousFallbackUrl === undefined) delete process.env.BHAI_ENGINE_FALLBACK_URL;
    else process.env.BHAI_ENGINE_FALLBACK_URL = previousFallbackUrl;
  }
});
