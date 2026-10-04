import test from "node:test";
import assert from "node:assert/strict";

import { bhaiEngineProbe } from "../src/engine.js";

test("BHAI engine probe verifies the configured remote model", async () => {
  const previousFetch = globalThis.fetch;
  let request;

  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      object: "list",
      data: [
        { id: "smollm2.gguf", object: "model", owned_by: "BHAI" }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await bhaiEngineProbe({
      url: "https://node.example",
      key: "secret-test-key",
      model: "smollm2.gguf"
    });

    assert.equal(result.ok, true);
    assert.equal(result.reachable, true);
    assert.equal(result.model, "smollm2.gguf");
    assert.equal(result.model_available, true);
    assert.deepEqual(result.available_models, ["smollm2.gguf"]);
    assert.equal(request.url, "https://node.example/v1/models");
    assert.equal(request.options.method, "GET");
    assert.equal(request.options.headers.authorization, "Bearer secret-test-key");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("BHAI engine probe reports a model mismatch without leaking the key", async () => {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(JSON.stringify({
    object: "list",
    data: [{ id: "other-model", object: "model" }]
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

  try {
    const result = await bhaiEngineProbe({
      url: "https://node.example/",
      key: "secret-test-key",
      model: "smollm2.gguf"
    });

    assert.equal(result.ok, false);
    assert.equal(result.reachable, true);
    assert.equal(result.model_available, false);
    assert.equal(result.available_models[0], "other-model");
    assert.equal("key" in result, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
