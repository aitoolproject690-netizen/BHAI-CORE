import test from "node:test";
import assert from "node:assert/strict";
import { getProviderStatus } from "../src/router.js";
test("provider status exposes all adapters",()=>{const s=getProviderStatus();for(const n of ["gemini","openai","anthropic","huggingface"]){assert.ok(s[n]);assert.equal(typeof s[n].configured,"boolean");assert.equal(typeof s[n].model,"string");}});
