import test from "node:test";
import assert from "node:assert/strict";
import { embedText } from "../src/embeddings.js";
import { rankVectors, stripVectors } from "../src/vectorStore.js";

test("vector ranking orders matching content first", () => {
  const items = [
    { id: "a", vector: embedText("BHAI deployment health checks") },
    { id: "b", vector: embedText("banana mountain bicycle") }
  ];
  const ranked = rankVectors(items, embedText("deployment health"));
  assert.equal(ranked[0].id, "a");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("vector ranking can hide vectors from public results", () => {
  const ranked = rankVectors(
    [{ id: "a", vector: embedText("hello") }],
    embedText("hello")
  );
  const safe = stripVectors(ranked);
  assert.equal("vector" in safe[0], false);
});
