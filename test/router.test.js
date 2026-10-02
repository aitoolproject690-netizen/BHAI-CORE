import test from "node:test";
import assert from "node:assert/strict";

import { getProviderStatus, normalizeMaxAttempts } from "../src/router.js";

test("provider status exposes all adapters",()=>{const s=getProviderStatus();for(const n of ["gemini","openai","anthropic","huggingface"]){assert.ok(s[n]);assert.equal(typeof s[n].configured,"boolean");assert.equal(typeof s[n].model,"string");}});

import { config } from "../src/config.js";

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
