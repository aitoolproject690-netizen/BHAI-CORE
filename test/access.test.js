import test from "node:test";
import assert from "node:assert/strict";
import { hasApiAccess } from "../src/access.js";

test("master auth disabled keeps existing open access when no core API key is configured", () => {
  assert.equal(hasApiAccess({ masterAuthEnabled: false, coreApiConfigured: false }), true);
});

test("legacy core bearer key or valid BHAI API key is accepted when master auth is disabled and core key is configured", () => {
  assert.equal(hasApiAccess({ masterAuthEnabled: false, coreApiConfigured: true, coreApiAuthenticated: true }), true);
  assert.equal(hasApiAccess({ masterAuthEnabled: false, coreApiConfigured: true, apiAuthenticated: true, coreApiAuthenticated: false }), true);
  assert.equal(hasApiAccess({ masterAuthEnabled: false, coreApiConfigured: true, apiAuthenticated: false, coreApiAuthenticated: false }), false);
});

test("valid BHAI API key is accepted when master auth is enabled even without legacy core API key", () => {
  assert.equal(hasApiAccess({ masterAuthEnabled: true, apiAuthenticated: true, coreApiConfigured: true, coreApiAuthenticated: false }), true);
});

test("authenticated dashboard session is accepted when master auth is enabled even without legacy core API key", () => {
  assert.equal(hasApiAccess({ masterAuthEnabled: true, sessionAuthenticated: true, coreApiConfigured: true, coreApiAuthenticated: false }), true);
});

test("master credentials are accepted when master auth is enabled", () => {
  assert.equal(hasApiAccess({ masterAuthEnabled: true, masterAuthenticated: true, coreApiConfigured: true, coreApiAuthenticated: false }), true);
});

test("core API key remains an additional accepted credential when master auth is enabled", () => {
  assert.equal(hasApiAccess({ masterAuthEnabled: true, coreApiAuthenticated: true, coreApiConfigured: true }), true);
});

test("unauthenticated request is rejected when master auth is enabled", () => {
  assert.equal(hasApiAccess({ masterAuthEnabled: true }), false);
});
