import test from "node:test";
import assert from "node:assert/strict";

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
