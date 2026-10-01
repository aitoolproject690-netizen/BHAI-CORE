import test from "node:test";
import assert from "node:assert/strict";
process.env.BHAI_RUNTIME_ENABLED="true";
import { createService, getService, stopService } from "../src/service.js";

test("service lifecycle is owner scoped", async () => {
  const s = await createService({ ownerId:"owner-1", buildId:"build-1", command:"sleep 5", cwd:process.cwd() });
  assert.equal((await getService(s.id,"owner-2")), null);
  const mine = await getService(s.id,"owner-1");
  assert.equal(mine.status,"running");
  await stopService(s.id,"owner-1");
});
