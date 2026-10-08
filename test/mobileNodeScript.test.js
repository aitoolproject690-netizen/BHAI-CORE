import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("mobile node script persistently advertises the local SmolLM2 engine", () => {
  const source = fs.readFileSync(new URL("../mobile-node/mobile-node.mjs", import.meta.url), "utf8");
  assert.match(source, /const MOBILE_ENGINES = \[/);
  assert.match(source, /id: "smollm2"/);
  assert.match(source, /capabilities: \["chat", "gpu"\]/);
  assert.match(source, /engines: MOBILE_ENGINES/);
  assert.match(source, /const NODE_ID =/);
  assert.match(source, /const NODE_VERSION =/);
});
