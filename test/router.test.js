import test from "node:test";
import assert from "node:assert/strict";

import { getProviderStatus, normalizeMaxAttempts } from "../src/router.js";

test("provider status exposes all adapters",()=>{const s=getProviderStatus();for(const n of ["gemini","openai","anthropic","huggingface"]){assert.ok(s[n]);assert.equal(typeof s[n].configured,"boolean");assert.equal(typeof s[n].model,"string");}});

import { config } from "../src/config.js";
import { publicError } from "../src/errors.js";

test("config rejects invalid PORT values", () => {
  const previous = process.env.PORT;
  try {
    process.env.PORT = "70000";
    assert.throws(() => config(), error => error.code === "CONFIG_PORT_INVALID" && error.status === 500);
  } finally {
    if (previous === undefined) delete process.env.PORT;
    else process.env.PORT = previous;
  }
});

test("normalizeMaxAttempts safely handles invalid limits", () => {
  assert.equal(normalizeMaxAttempts(undefined, 4), 4);
  assert.equal(normalizeMaxAttempts(0, 4), 4);
  assert.equal(normalizeMaxAttempts(-2, 4), 4);
  assert.equal(normalizeMaxAttempts("nope", 4), 4);
  assert.equal(normalizeMaxAttempts(2, 4), 2);
  assert.equal(normalizeMaxAttempts(99, 4), 4);
});

test("isProviderConfigured requires a callable adapter", async () => {
  const { isProviderConfigured } = await import("../src/router.js");
  const { providerAdapters } = await import("../src/providers.js");
  const { config } = await import("../src/config.js");
  const cfg = config();
  const previous = providerAdapters.__invalid;
  providerAdapters.__invalid = { notCallable: true };
  cfg.providers.__invalid = { key: "test", model: "test" };
  try {
    assert.equal(isProviderConfigured("__invalid", cfg), false);
  } finally {
    if (previous === undefined) delete providerAdapters.__invalid;
    else providerAdapters.__invalid = previous;
  }
});

test("provider status tolerates adapter/config drift", async () => {
  const { providerAdapters } = await import("../src/providers.js");
  const previousAdapter = providerAdapters.__missingConfig;
  const previousConfig = process.env.BHAI_PROVIDER_ORDER;
  providerAdapters.__missingConfig = async () => ({ text: "ok" });
  try {
    process.env.BHAI_PROVIDER_ORDER = "";
    const { getProviderStatus } = await import("../src/router.js");
    const status = getProviderStatus();
    assert.equal(status.__missingConfig.configured, false);
    assert.equal(status.__missingConfig.model, "");
    assert.equal(status.__missingConfig.enabled, false);
  } finally {
    if (previousAdapter === undefined) delete providerAdapters.__missingConfig;
    else providerAdapters.__missingConfig = previousAdapter;
    if (previousConfig === undefined) delete process.env.BHAI_PROVIDER_ORDER;
    else process.env.BHAI_PROVIDER_ORDER = previousConfig;
  }
});

test("generate routes through a configured adapter and records the result", async () => {
  const { generate } = await import("../src/router.js");
  const { providerAdapters } = await import("../src/providers.js");
  const { resetStoreForTests, getStore } = await import("../src/store.js");
  resetStoreForTests();

  const previousOrder = process.env.AI_PROVIDER_ORDER;
  const previousKey = process.env.OPENAI_API_KEY;
  const previousRetries = process.env.BHAI_PROVIDER_RETRIES;
  const previousAdapter = providerAdapters.openai;

  process.env.AI_PROVIDER_ORDER = "openai";
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.BHAI_PROVIDER_RETRIES = "0";
  providerAdapters.openai = async ({ messages, temperature }) => ({
    text: messages[0].content + ":" + temperature
  });

  try {
    const result = await generate({
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.2
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "openai");
    assert.equal(result.text, "hello:0.2");
    assert.equal(result.attempts, 1);
    assert.equal(result.retries, 0);

    const store = await getStore();
    assert.equal(store.providerUsage.openai.requests, 1);
    assert.equal(store.providerUsage.openai.failures, 0);
  } finally {
    providerAdapters.openai = previousAdapter;
    if (previousOrder === undefined) delete process.env.AI_PROVIDER_ORDER;
    else process.env.AI_PROVIDER_ORDER = previousOrder;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousRetries === undefined) delete process.env.BHAI_PROVIDER_RETRIES;
    else process.env.BHAI_PROVIDER_RETRIES = previousRetries;
  }
});

test("generate retries retryable provider failures before succeeding", async () => {
  const { generate } = await import("../src/router.js");
  const { providerAdapters } = await import("../src/providers.js");

  const previousOrder = process.env.AI_PROVIDER_ORDER;
  const previousKey = process.env.OPENAI_API_KEY;
  const previousRetries = process.env.BHAI_PROVIDER_RETRIES;
  const previousAdapter = providerAdapters.openai;
  let calls = 0;

  process.env.AI_PROVIDER_ORDER = "openai";
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.BHAI_PROVIDER_RETRIES = "1";
  providerAdapters.openai = async () => {
    calls += 1;
    if (calls === 1) {
      throw Object.assign(new Error("temporary outage"), { code: "TEMPORARY" });
    }
    return { text: "retry success" };
  };

  try {
    const result = await generate({
      messages: [{ role: "user", content: "hello" }]
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "openai");
    assert.equal(result.text, "retry success");
    assert.equal(result.attempts, 1);
    assert.equal(result.retries, 1);
    assert.equal(calls, 2);
  } finally {
    providerAdapters.openai = previousAdapter;
    if (previousOrder === undefined) delete process.env.AI_PROVIDER_ORDER;
    else process.env.AI_PROVIDER_ORDER = previousOrder;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousRetries === undefined) delete process.env.BHAI_PROVIDER_RETRIES;
    else process.env.BHAI_PROVIDER_RETRIES = previousRetries;
  }
});

test("generate falls back after a provider failure", async () => {
  const { generate } = await import("../src/router.js");
  const { providerAdapters } = await import("../src/providers.js");
  const { resetStoreForTests } = await import("../src/store.js");
  resetStoreForTests();

  const previousOrder = process.env.AI_PROVIDER_ORDER;
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const previousOpenaiKey = process.env.OPENAI_API_KEY;
  const previousRetries = process.env.BHAI_PROVIDER_RETRIES;
  const previousGemini = providerAdapters.gemini;
  const previousOpenai = providerAdapters.openai;

  process.env.AI_PROVIDER_ORDER = "gemini,openai";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.BHAI_PROVIDER_RETRIES = "0";
  providerAdapters.gemini = async () => {
    throw Object.assign(new Error("temporary provider failure"), { code: "TEMPORARY" });
  };
  providerAdapters.openai = async () => ({ text: "fallback ok" });

  try {
    const result = await generate({
      messages: [{ role: "user", content: "hello" }],
      maxAttempts: 2
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "openai");
    assert.equal(result.text, "fallback ok");
    assert.equal(result.attempts, 2);
  } finally {
    providerAdapters.gemini = previousGemini;
    providerAdapters.openai = previousOpenai;
    if (previousOrder === undefined) delete process.env.AI_PROVIDER_ORDER;
    else process.env.AI_PROVIDER_ORDER = previousOrder;
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
    if (previousOpenaiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenaiKey;
    if (previousRetries === undefined) delete process.env.BHAI_PROVIDER_RETRIES;
    else process.env.BHAI_PROVIDER_RETRIES = previousRetries;
  }
});


test("generate honors an explicit provider selection", async () => {
  const { generate } = await import("../src/router.js");
  const { providerAdapters } = await import("../src/providers.js");

  const previousOrder = process.env.AI_PROVIDER_ORDER;
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const previousOpenaiKey = process.env.OPENAI_API_KEY;
  const previousGemini = providerAdapters.gemini;
  const previousOpenai = providerAdapters.openai;

  process.env.AI_PROVIDER_ORDER = "openai,gemini";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  providerAdapters.gemini = async () => ({ text: "selected gemini" });
  providerAdapters.openai = async () => ({ text: "wrong provider" });

  try {
    const result = await generate({
      provider: "GEMINI",
      messages: [{ role: "user", content: "hello" }]
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "gemini");
    assert.equal(result.text, "selected gemini");
  } finally {
    providerAdapters.gemini = previousGemini;
    providerAdapters.openai = previousOpenai;
    if (previousOrder === undefined) delete process.env.AI_PROVIDER_ORDER;
    else process.env.AI_PROVIDER_ORDER = previousOrder;
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
    if (previousOpenaiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenaiKey;
  }
});

test("generate reports configured provider failures with sanitized details", async () => {
  const { generate } = await import("../src/router.js");
  const { providerAdapters } = await import("../src/providers.js");

  const previousOrder = process.env.AI_PROVIDER_ORDER;
  const previousKey = process.env.OPENAI_API_KEY;
  const previousRetries = process.env.BHAI_PROVIDER_RETRIES;
  const previousAdapter = providerAdapters.openai;

  process.env.AI_PROVIDER_ORDER = "openai";
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.BHAI_PROVIDER_RETRIES = "0";
  providerAdapters.openai = async () => {
    throw Object.assign(
      new Error("request failed with api_key=secret-value"),
      { code: "PERMANENT" }
    );
  };

  try {
    await assert.rejects(
      () => generate({
        messages: [{ role: "user", content: "hello" }]
      }),
      error => {
        assert.equal(error.message, "All configured AI providers failed");
        assert.equal(error.details.length, 1);
        assert.equal(error.details[0].provider, "openai");
        assert.equal(error.details[0].kind, "permanent");
        assert.equal(error.details[0].error, "request failed with api_key=secret-value");
        const safe = publicError(error);
        assert.equal(safe.details[0].error, "request failed with api_key=[redacted]");
        return true;
      }
    );
  } finally {
    providerAdapters.openai = previousAdapter;
    if (previousOrder === undefined) delete process.env.AI_PROVIDER_ORDER;
    else process.env.AI_PROVIDER_ORDER = previousOrder;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousRetries === undefined) delete process.env.BHAI_PROVIDER_RETRIES;
    else process.env.BHAI_PROVIDER_RETRIES = previousRetries;
  }
});
