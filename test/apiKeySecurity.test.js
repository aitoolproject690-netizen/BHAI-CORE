import test from "node:test";
import assert from "node:assert/strict";
import { createApiKey, authenticate, rotateApiKey, revokeApiKey } from "../src/auth.js";
import { resetStoreForTests } from "../src/store.js";

test("API keys preserve scopes and per-key limits", async () => {
  resetStoreForTests();
  const created = await createApiKey("limited-app", ["agent:read"], { maxRequests: 25, maxInputChars: 5000 });
  const identity = await authenticate(created.key);
  assert.equal(identity.name, "limited-app");
  assert.deepEqual(identity.scopes, ["agent:read"]);
  assert.deepEqual(identity.limits, { maxRequests: 25, maxInputChars: 5000 });
});

test("API key rotation revokes the old key and returns a new secret", async () => {
  resetStoreForTests();
  const created = await createApiKey("rotate-me");
  const rotated = await rotateApiKey(created.id);
  assert.ok(rotated?.key?.startsWith("bhai_"));
  assert.equal(await authenticate(created.key), null);
  assert.equal((await authenticate(rotated.key)).id, rotated.id);
});

test("revocation records the inactive state", async () => {
  resetStoreForTests();
  const created = await createApiKey("revoke-me");
  assert.equal(await revokeApiKey(created.id), true);
  assert.equal(await authenticate(created.key), null);
});
