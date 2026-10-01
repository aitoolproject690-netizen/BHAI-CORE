import test from "node:test";
import assert from "node:assert/strict";
import { resetStoreForTests } from "../src/store.js";
import {
  createConversation,
  listConversations,
  getConversation,
  appendMessage,
  getConversationContext,
  deleteConversation
} from "../src/memory.js";

test.beforeEach(() => resetStoreForTests());

test("conversation memory is owner scoped and persistent in store", async () => {
  const one = await createConversation("owner_a", "Test chat");
  await appendMessage(one.id, "owner_a", { role: "user", content: "hello" });
  await appendMessage(one.id, "owner_a", { role: "assistant", content: "hi bhai" });

  assert.equal((await getConversation(one.id, "owner_a")).messages.length, 2);
  assert.equal(await getConversation(one.id, "owner_b"), null);
  assert.equal((await listConversations("owner_a")).length, 1);
  assert.equal((await listConversations("owner_b")).length, 0);
});

test("context is bounded and secrets are redacted", async () => {
  const c = await createConversation("owner_a");
  await appendMessage(c.id, "owner_a", {
    role: "user",
    content: "my key is bhai_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
  });
  const context = await getConversationContext(c.id, "owner_a");
  assert.match(context.messages[0].content, /REDACTED_KEY/);
  assert.doesNotMatch(context.messages[0].content, /bhai_[A-Za-z0-9_-]{20,}/);
});

test("delete removes only the owner's conversation", async () => {
  const c = await createConversation("owner_a");
  assert.equal(await deleteConversation(c.id, "owner_b"), false);
  assert.equal(await deleteConversation(c.id, "owner_a"), true);
  assert.equal(await getConversation(c.id, "owner_a"), null);
});
