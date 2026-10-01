import test from "node:test";
import assert from "node:assert/strict";
import { createApiKey, authenticate, revokeApiKey, listApiKeys, resetApiKeys } from "../src/auth.js";

test("API keys authenticate and revoke", async () => {
  resetApiKeys();
  const created = createApiKey("test");
  assert.equal(authenticate(created.key).name, "test");
  assert.equal(listApiKeys().length, 1);
  assert.equal(revokeApiKey(created.id), true);
  assert.equal(authenticate(created.key), null);
});
