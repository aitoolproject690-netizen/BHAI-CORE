import test from "node:test";
import assert from "node:assert/strict";
import { tokenEvent, completeEvent } from "../src/events.js";

test("events use stable protocol", () => {
  assert.deepEqual(tokenEvent("hello"), { type:"token", text:"hello" });
  assert.deepEqual(completeEvent({provider:"demo",model:"m",attempts:1}), {
    type:"complete", provider:"demo", model:"m", attempts:1
  });
});
