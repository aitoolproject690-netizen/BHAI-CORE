import test from "node:test";
import assert from "node:assert/strict";

import { providerAdapters } from "../src/providers.js";

test("anthropic preserves system messages separately", async () => {
  const previousFetch = globalThis.fetch;
  let request;

  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      content: [{ text: "ok" }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await providerAdapters.anthropic({
      key: "test-key",
      model: "test-model",
      messages: [
        { role: "system", content: "You are BHAI." },
        { role: "user", content: "hello" }
      ]
    });

    assert.equal(result.text, "ok");
    const body = JSON.parse(request.options.body);
    assert.equal(body.system, "You are BHAI.");
    assert.deepEqual(body.messages, [{ role: "user", content: "hello" }]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
