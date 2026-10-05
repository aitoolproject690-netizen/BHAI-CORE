import test from "node:test";
import assert from "node:assert/strict";
import { createApiKey, authenticate, revokeApiKey, listApiKeys } from "../src/auth.js";
import { resetStoreForTests } from "../src/store.js";

test("API keys store selected engine modules", async () => {
  resetStoreForTests();
  const created = await createApiKey("scoped", undefined, {}, ["chat", "image"]);
  assert.deepEqual(created.modules, ["chat", "image"]);
  assert.ok(created.scopes.includes("agent:read"));
  assert.ok(created.scopes.includes("image:write"));
  const identity = await authenticate(created.key);
  assert.deepEqual(identity.modules, ["chat", "image"]);
  assert.equal(await revokeApiKey(created.id), true);
});
test("API keys authenticate and revoke", async () => {
  resetStoreForTests();
  const created = await createApiKey("test");
  assert.equal((await authenticate(created.key)).name, "test");
  assert.equal((await listApiKeys()).length, 1);
  assert.equal(await revokeApiKey(created.id), true);
  assert.equal(await authenticate(created.key), null);
});
