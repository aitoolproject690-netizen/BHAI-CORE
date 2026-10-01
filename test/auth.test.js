import test from "node:test";
import assert from "node:assert/strict";
import { createApiKey, authenticate, revokeApiKey, listApiKeys } from "../src/auth.js";
import { resetStoreForTests } from "../src/store.js";

test("API keys authenticate and revoke", async () => {
  resetStoreForTests();
  const created = await createApiKey("test");
  assert.equal((await authenticate(created.key)).name, "test");
  assert.equal((await listApiKeys()).length, 1);
  assert.equal(await revokeApiKey(created.id), true);
  assert.equal(await authenticate(created.key), null);
});
