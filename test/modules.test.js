import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_MODULE_IDS,
  expandModulePermissions,
  moduleCatalog,
  moduleForRequest,
  modulesForScopes,
  normalizeModuleIds
} from "../src/modules.js";

test("module catalog exposes all engine modules", () => {
  assert.equal(moduleCatalog().length, 8);
  assert.deepEqual(ALL_MODULE_IDS, [
    "chat", "rag", "agent", "image", "video", "voice_vision", "github_cloud", "billing"
  ]);
});

test("module selection expands to real permissions", () => {
  assert.deepEqual(
    expandModulePermissions(["chat", "image", "billing"]),
    ["agent:read", "image:write", "billing:read", "billing:write"]
  );
});

test("module input rejects unknown modules", () => {
  assert.throws(
    () => normalizeModuleIds(["chat", "not-real"]),
    error => error?.code === "MODULE_INVALID" && error?.status === 400
  );
});

test("scopes can recover selected modules and legacy defaults keep all access", () => {
  assert.deepEqual(modulesForScopes(["agent:read"]), ["chat"]);
  assert.deepEqual(modulesForScopes(undefined), ALL_MODULE_IDS);
  assert.deepEqual(modulesForScopes(["*"]), ALL_MODULE_IDS);
});

test("API paths map to module access boundaries", () => {
  assert.equal(moduleForRequest("/v1/chat/completions", "POST"), "chat");
  assert.equal(moduleForRequest("/v1/rag/search", "GET"), "rag");
  assert.equal(moduleForRequest("/v1/agent/execute", "POST"), "agent");
  assert.equal(moduleForRequest("/v1/image/generate", "POST"), "image");
  assert.equal(moduleForRequest("/v1/video/plan", "POST"), "video");
  assert.equal(moduleForRequest("/v1/voice/transcribe", "POST"), "voice_vision");
  assert.equal(moduleForRequest("/v1/cloud/build/info", "GET"), "github_cloud");
  assert.equal(moduleForRequest("/v1/billing/usage", "GET"), "billing");
  assert.equal(moduleForRequest("/v1/modules", "GET"), null);
});
