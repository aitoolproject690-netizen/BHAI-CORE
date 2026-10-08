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


import { rawRgbToPng, parseLocalDreamSse, localDreamRequestPayload } from "../src/image.js";

test("Local Dream raw RGB is converted into a valid PNG", () => {
  const raw = Buffer.from([255,0,0, 0,255,0]).toString("base64");
  const png = rawRgbToPng(raw, 2, 1);
  assert.deepEqual([...png.subarray(0,8)], [137,80,78,71,13,10,26,10]);
  assert.ok(png.length > 32);
});

test("Local Dream SSE parser returns the completed frame", () => {
  const rgb = Buffer.from([255,0,0]).toString("base64");
  const progress = JSON.stringify({ type: "progress", step: 1 });
  const complete = JSON.stringify({ type: "complete", image: rgb, seed: 42, width: 1, height: 1 });
  const event = parseLocalDreamSse(
    "event: progress\ndata: " + progress + "\n\n" +
    "event: complete\ndata: " + complete + "\n"
  );
  assert.equal(event.type, "complete");
  assert.equal(event.seed, 42);
});

test("Local Dream payload keeps bounded mobile generation settings", () => {
  const payload = localDreamRequestPayload({
    prompt: "cinematic hero",
    aspectRatio: "9:16",
    steps: 999,
    cfg: 99,
    seed: -1
  });
  assert.deepEqual(
    { size: payload.size, steps: payload.steps, cfg: payload.cfg, scheduler: payload.scheduler, use_opencl: payload.use_opencl },
    { size: 512, steps: 30, cfg: 15, scheduler: "dpm", use_opencl: false }
  );
});
