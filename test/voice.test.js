import test from "node:test";
import assert from "node:assert/strict";
import { createSpeechRequest, createTtsRequest } from "../src/voice.js";

test("STT request validates audio", () => {
  const r = createSpeechRequest({ audio: Buffer.from("hello").toString("base64"), language: "hi" });
  assert.match(r.id, /^stt_/); assert.equal(r.language, "hi");
});
test("TTS request validates text", () => {
  const r = createTtsRequest({ text: "Namaste bhai", language: "hi" });
  assert.match(r.id, /^tts_/); assert.equal(r.text, "Namaste bhai");
});
test("TTS rejects empty text", () => { assert.throws(() => createTtsRequest({ text: "" }), /text is required/); });