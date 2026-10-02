import test from "node:test";
import assert from "node:assert/strict";
import { getProviderStatus } from "../src/router.js";
test("provider status exposes all adapters",()=>{const s=getProviderStatus();for(const n of ["gemini","openai","anthropic","huggingface"]){assert.ok(s[n]);assert.equal(typeof s[n].configured,"boolean");assert.equal(typeof s[n].model,"string");}});

import { config } from "../src/config.js";

test("config rejects invalid PORT values", () => {
  const previous = process.env.PORT;
  try {
    process.env.PORT = "70000";
    assert.throws(() => config(), error => error.code === "CONFIG_PORT_INVALID" && error.status === 500);
  } finally {
    if (previous === undefined) delete process.env.PORT;
    else process.env.PORT = previous;
  }
});
