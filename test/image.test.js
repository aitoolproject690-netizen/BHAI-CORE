import test from "node:test";
import assert from "node:assert/strict";
import { createImageRequest } from "../src/image.js";

test("image request validates prompt and normalizes provider", () => {
  const result = createImageRequest({ prompt: "A cinematic mountain", provider: "ComfyUI", seed: 42 });
  assert.equal(result.provider, "comfyui");
  assert.equal(result.prompt, "A cinematic mountain");
  assert.equal(result.seed, 42);
  assert.match(result.id, /^img_/);
});

test("image request rejects empty prompt", () => {
  assert.throws(() => createImageRequest({ prompt: "" }), /prompt is required/);
});

import { recordImageJobOwnership, getImageJobOwnership } from "../src/image.js";
import { resetStoreForTests } from "../src/store.js";

test("image job ownership is tenant isolated", async () => {
  resetStoreForTests();
  await recordImageJobOwnership({ promptId: "prompt-123", ownerId: "owner-a", requestId: "req-1" });
  assert.equal((await getImageJobOwnership("prompt-123", "owner-a")).ownerId, "owner-a");
  assert.equal(await getImageJobOwnership("prompt-123", "owner-b"), null);
});
