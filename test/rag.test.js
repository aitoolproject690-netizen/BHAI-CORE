import test from "node:test";
import assert from "node:assert/strict";
import { createTextFile } from "../src/files.js";
import { chunkText, indexFile, searchRag, ragContext } from "../src/rag.js";
import { resetStoreForTests } from "../src/store.js";

test("chunking creates overlapping bounded chunks", () => {
  const chunks = chunkText("a".repeat(1000), { size: 300, overlap: 50 });
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every(chunk => chunk.content.length <= 300));
  assert.ok(chunks[1].start < chunks[0].end);
});

test("RAG search is owner scoped and ranked", async () => {
  resetStoreForTests();
  const a = await createTextFile({
    ownerId: "a",
    name: "guide.txt",
    text: "BHAI deployment guide. Deploy apps with health checks and logs."
  });
  const b = await createTextFile({
    ownerId: "b",
    name: "secret.txt",
    text: "BHAI deployment secret for another owner."
  });

  await indexFile({ ...a, text: (await import("../src/files.js")).getFile ? (await (await import("../src/files.js")).getFile(a.id, "a")).text : "" });
  await indexFile({ ...b, text: "BHAI deployment secret for another owner.", ownerId: "b" });

  const results = await searchRag("a", "deployment health");
  assert.equal(results.length, 1);
  assert.equal(results[0].fileId, a.id);
});

test("RAG context includes source labels", async () => {
  resetStoreForTests();
  const file = await createTextFile({
    ownerId: "a",
    name: "notes.txt",
    text: "Vector search can later replace keyword search."
  });
  const full = await (await import("../src/files.js")).getFile(file.id, "a");
  await indexFile(full);

  const context = await ragContext("a", "vector search");
  assert.match(context.context, /Source 1/);
  assert.match(context.context, /Vector search/);
});

test("RAG tokenization supports Hindi text", async () => {
  resetStoreForTests();
  const file = await createTextFile({
    ownerId: "hindi-user",
    name: "hindi.txt",
    text: "भाई यह BHAI CORE की हिंदी फाइल है।"
  });
  const results = await searchRag("hindi-user", "हिंदी फाइल");
  assert.equal(results[0].fileId, file.id);
});

import { embedText } from "../src/embeddings.js";

test("local embeddings include Unicode tokens", () => {
  const hindi = embedText("हिंदी");
  const latin = embedText("english");
  assert.ok(hindi.some(value => value !== 0));
  assert.ok(latin.some(value => value !== 0));
  assert.notDeepEqual(hindi, new Array(hindi.length).fill(0));
});
