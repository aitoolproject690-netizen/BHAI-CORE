import test from "node:test";
import assert from "node:assert/strict";
import { resetStoreForTests } from "../src/store.js";
import { recordAudit, listAudit } from "../src/audit.js";
import { createApproval, getApproval, decideApproval } from "../src/approval.js";

test("audit events are owner scoped and persisted", async () => {
  resetStoreForTests();
  await recordAudit({ actorId: "u1", action: "test", tool: "chat", status: "started" });
  await recordAudit({ actorId: "u2", action: "other", tool: "models", status: "started" });
  const events = await listAudit({ actorId: "u1" });
  assert.equal(events.length, 1);
  assert.equal(events[0].actorId, "u1");
});

test("approval lifecycle is owner scoped", async () => {
  resetStoreForTests();
  const created = await createApproval({ actorId: "u1", tool: "future_tool", input: { x: 1 } });
  assert.equal((await getApproval(created.id, "u2")), null);
  assert.equal((await getApproval(created.id, "u1")).status, "pending");
  const approved = await decideApproval(created.id, "u1", "approved");
  assert.equal(approved.status, "approved");
  assert.equal((await decideApproval(created.id, "u1", "rejected")), null);
});
