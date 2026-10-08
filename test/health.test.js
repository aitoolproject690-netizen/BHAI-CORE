import test from "node:test";
import assert from "node:assert/strict";
import { health } from "../src/health.js";

test("health returns stable service identity", () => {
  const result = health();
  assert.equal(result.ok, true);
  assert.equal(result.service, "BHAI-CORE");
  assert.ok(result.mobileNode);
  assert.equal(typeof result.mobileNode.connected, "boolean");
  assert.ok(["token", "token+node-id"].includes(result.mobileNode.pairingMode));
});
