import test from "node:test";
import assert from "node:assert/strict";
import { writeSSE } from "../src/stream.js";

test("SSE formatter writes event and JSON data", () => {
  const chunks=[];
  const res={ write(v){ chunks.push(v); } };
  writeSSE(res,"token",{text:"hello"});
  assert.equal(chunks[0], 'event: token\ndata: {"text":"hello"}\n\n');
});
