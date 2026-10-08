import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("mobile node script persistently advertises the local SmolLM2 engine", () => {
  const source = fs.readFileSync(new URL("../mobile-node/mobile-node.mjs", import.meta.url), "utf8");
  assert.match(source, /function buildMobileEngines\(/);
  assert.match(source, /id: "smollm2"/);
  assert.match(source, /capabilities: \["chat", "gpu"\]/);
  assert.match(source, /engines,/);
  assert.match(source, /const NODE_ID =/);
  assert.match(source, /const NODE_VERSION =/);
});



test("mobile node script splits Local Dream image traffic from llama-server", () => {
  const source = fs.readFileSync(new URL("../mobile-node/mobile-node.mjs", import.meta.url), "utf8");
  assert.match(source, /LOCAL_IMAGE_ENGINE.*127\.0\.0\.1:8081/);
  assert.match(source, /path === "\/generate"/);
  assert.match(source, /image-engine/);
  assert.match(source, /async function probeLocalImageEngine/);
});
