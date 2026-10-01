import test from "node:test";
import assert from "node:assert/strict";
import { createTextFile, getFile, listFiles, searchFiles, deleteFile } from "../src/files.js";
import { resetStoreForTests } from "../src/store.js";

test("file metadata is isolated by owner", async () => {
  resetStoreForTests();
  const file = await createTextFile({ ownerId: "user-a", name: "../notes.txt", text: "BHAI CORE hello world" });
  assert.equal(file.name, "notes.txt");
  assert.equal((await listFiles("user-a")).length, 1);
  assert.equal((await listFiles("user-b")).length, 0);
  assert.equal((await getFile(file.id, "user-b")), null);
});

test("file search returns matching snippets", async () => {
  resetStoreForTests();
  const file = await createTextFile({ ownerId: "user-a", name: "notes.txt", text: "alpha beta BHAI CORE search target gamma" });
  const results = await searchFiles("user-a", "BHAI CORE");
  assert.equal(results[0].id, file.id);
  assert.match(results[0].snippet, /BHAI CORE/);
});

test("file can be deleted by its owner", async () => {
  resetStoreForTests();
  const file = await createTextFile({ ownerId: "user-a", name: "x.txt", text: "hello" });
  assert.equal(await deleteFile(file.id, "user-b"), false);
  assert.equal(await deleteFile(file.id, "user-a"), true);
  assert.equal(await getFile(file.id, "user-a"), null);
});
