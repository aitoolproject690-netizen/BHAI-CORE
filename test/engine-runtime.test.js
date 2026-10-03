import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("self-hosted engine runtime manifest is present and pinned", () => {
  const pkg = JSON.parse(fs.readFileSync("engine/package.json", "utf8"));
  assert.equal(pkg.dependencies["node-llama-cpp"], "3.22.1");
  assert.equal(pkg.scripts.start, "node server.js");
  const server = fs.readFileSync("engine/server.js", "utf8");
  assert.match(server, /\/v1\/chat\/completions/);
  assert.match(server, /BHAI_ENGINE_API_KEY/);
  assert.match(server, /LlamaChatSession/);
});
