import test from "node:test";
import assert from "node:assert/strict";

import { bhaiEngineChat } from "../src/engine.js";

test("engine client falls back after a primary target failure", async () => {
  const previousFetch = global.fetch;
  const calls = [];

  global.fetch = async url => {
    calls.push(String(url));
    if (String(url).includes("primary.test")) {
      return new Response(
        JSON.stringify({ error: { message: "primary unavailable" } }),
        { status: 503, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "hello from fallback" } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const result = await bhaiEngineChat({
      url: "https://primary.test",
      key: "primary-key",
      model: "phone-model",
      fallbackUrl: "https://fallback.test",
      fallbackKey: "fallback-key",
      fallbackModel: "fallback-model",
      messages: [{ role: "user", content: "hello" }]
    });

    assert.equal(result.text, "hello from fallback");
    assert.equal(result.fallback_used, true);
    assert.deepEqual(calls, [
      "https://primary.test/v1/chat/completions",
      "https://fallback.test/v1/chat/completions"
    ]);
  } finally {
    global.fetch = previousFetch;
  }
});
