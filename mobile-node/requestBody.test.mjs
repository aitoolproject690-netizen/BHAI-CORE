import test from "node:test";
import assert from "node:assert/strict";
import { prepareLocalTextRequestBody } from "./requestBody.mjs";

test("disables cached prompt reuse for chat completions", () => {
  const input = JSON.stringify({ messages: [{ role: "user", content: "hello" }] });
  const output = JSON.parse(prepareLocalTextRequestBody("/v1/chat/completions", "POST", input));
  assert.equal(output.cache_prompt, false);
  assert.deepEqual(output.messages, [{ role: "user", content: "hello" }]);
});

test("overrides cache_prompt true to avoid stale-prefix reuse", () => {
  const output = JSON.parse(prepareLocalTextRequestBody("/completion", "POST",
    JSON.stringify({ prompt: "hello", cache_prompt: true })));
  assert.equal(output.cache_prompt, false);
});

test("does not rewrite image, GET, or unrelated routes", () => {
  const input = JSON.stringify({ cache_prompt: true });
  assert.equal(prepareLocalTextRequestBody("/generate", "POST", input), input);
  assert.equal(prepareLocalTextRequestBody("/v1/chat/completions", "GET", input), input);
  assert.equal(prepareLocalTextRequestBody("/v1/models", "POST", input), input);
});

test("leaves malformed bodies untouched", () => {
  assert.equal(prepareLocalTextRequestBody("/completion", "POST", "{bad"), "{bad");
});
