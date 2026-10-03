import test from "node:test";
import assert from "node:assert/strict";
import { hasApiAccess } from "../src/access.js";

test("master auth disabled keeps existing open access behavior", () => {
  assert.equal(hasApiAccess({ masterAuthEnabled: false }), true);
});

test("valid API key is accepted when master auth is enabled", () => {
  assert.equal(hasApiAccess({ masterAuthEnabled: true, apiAuthenticated: true }), true);
});

test("authenticated dashboard session is accepted when master auth is enabled", () => {
  assert.equal(hasApiAccess({ masterAuthEnabled: true, sessionAuthenticated: true }), true);
});

test("master credentials are accepted when master auth is enabled", () => {
  assert.equal(hasApiAccess({ masterAuthEnabled: true, masterAuthenticated: true }), true);
});

test("unauthenticated request is rejected when master auth is enabled", () => {
  assert.equal(hasApiAccess({ masterAuthEnabled: true }), false);
});

test("invalid API key alone is rejected when master auth is enabled", () => {
  assert.equal(hasApiAccess({ masterAuthEnabled: true, apiAuthenticated: false }), false);
});
