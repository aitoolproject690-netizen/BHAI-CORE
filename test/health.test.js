import test from "node:test";
import assert from "node:assert/strict";
import { health } from "../src/health.js";

test("health returns stable service identity", () => {
  const result = health();
  assert.equal(result.ok, true);
  assert.equal(result.service, "BHAI-CORE");
});
