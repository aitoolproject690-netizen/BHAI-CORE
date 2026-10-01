import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspace, cleanupWorkspace } from "../src/workspace.js";
import fs from "node:fs/promises";

test("workspace is owner-scoped and temporary", async () => {
  const ws = await createWorkspace({ ownerId: "owner-1", repository: "demo/app" });
  assert.equal(ws.ownerId, "owner-1");
  assert.match(ws.id, /^ws_/);
  assert.match(ws.path, /owner-1/);
  const stat = await fs.stat(ws.path);
  assert.equal(stat.isDirectory(), true);
  await cleanupWorkspace(ws);
  await assert.rejects(() => fs.stat(ws.path));
});

test("workspace validates repository", async () => {
  await assert.rejects(() => createWorkspace({ ownerId: "x", repository: "../bad" }));
});
