import test from "node:test";
import assert from "node:assert/strict";
import { normalizeVisionRequest } from "../src/vision.js";

test("vision request accepts data URLs", () => {
  const result = normalizeVisionRequest({ prompt: "What is here?", image: { data: "data:image/png;base64,SGVsbG8=" } });
  assert.equal(result.image.mimeType, "image/png");
  assert.equal(result.image.data, "SGVsbG8=");
});

test("vision request rejects unsupported types", () => {
  assert.throws(() => normalizeVisionRequest({ image: { data: "data:text/plain;base64,SGVsbG8=" } }), /Unsupported image type/);
});