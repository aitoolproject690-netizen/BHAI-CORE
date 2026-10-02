import test from "node:test";
import assert from "node:assert/strict";
import { publicError } from "../src/errors.js";

test("public errors redact API keys from messages and details", () => {
  const result = publicError({
    message: "provider failed with bhai_super_secret and Bearer top-secret",
    details: [{ provider: "gemini", kind: "auth", error: "api_key=bhai_another_secret" }]
  });
  assert.equal(result.error.includes("bhai_super_secret"), false);
  assert.equal(result.error.includes("top-secret"), false);
  assert.equal(result.details[0].provider, "gemini");
  assert.equal(result.details[0].kind, "auth");
  assert.equal(result.details[0].error.includes("bhai_another_secret"), false);
  assert.equal(result.details[0].error.includes("[redacted]"), true);
});

test("public errors redact provider query-string keys", () => {
  const result = publicError({
    message: "provider request failed: https://example.test/v1?key=super-secret&model=test"
  });
  assert.equal(result.error.includes("key=super-secret"), false);
  assert.equal(result.error.includes("key=[redacted]"), true);
  assert.equal(result.error.includes("model=test"), true);
});
