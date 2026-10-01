import test from "node:test";
import assert from "node:assert/strict";
import { getConfiguredModelRegistry, modelCapabilities } from "../src/models.js";

test("model registry exposes configured providers without credentials", () => {
  const result = getConfiguredModelRegistry();
  assert.ok(Array.isArray(result));
  for (const item of result) {
    assert.ok(item.id.includes(":"));
    assert.equal(typeof item.capabilities.chat, "boolean");
    assert.equal(typeof item.capabilities.vision, "boolean");
    assert.equal(typeof item.capabilities.local, "boolean");
  }
});

test("Ollama models are marked local", () => {
  const caps = modelCapabilities("ollama", "llama3.2");
  assert.equal(caps.local, true);
  assert.equal(caps.chat, true);
});

test("vision-capable model detection works", () => {
  assert.equal(modelCapabilities("ollama", "llava:latest").vision, true);
  assert.equal(modelCapabilities("gemini", "gemini-2.5-flash").vision, true);
});
