import test from "node:test";
import assert from "node:assert/strict";
import { embedText, cosineSimilarity, embeddingInfo } from "../src/embeddings.js";

test("local embedder is deterministic and normalized", () => {
  const a = embedText("BHAI deployment health checks");
  const b = embedText("BHAI deployment health checks");
  assert.deepEqual(a, b);
  assert.ok(Math.abs(cosineSimilarity(a, a) - 1) < 1e-9);
});

test("different text can produce different vectors", () => {
  const a = embedText("deployment health checks");
  const b = embedText("banana mountain bicycle");
  assert.notDeepEqual(a, b);
});

test("embedding info exposes replaceable local baseline", () => {
  const info = embeddingInfo();
  assert.equal(info.provider, "local-hash");
  assert.equal(info.semantic, false);
  assert.equal(info.replaceable, true);
});
