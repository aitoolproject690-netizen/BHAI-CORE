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


import { rawRgbToPng, parseLocalDreamSse, localDreamRequestPayload, buildComfyUIWorkflow, submitComfyUI } from "../src/image.js";

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


test("FLUX Schnell preset uses its distilled low-guidance workflow and model", () => {
  const workflow = buildComfyUIWorkflow(
    { prompt: "cinematic Indian village at golden hour", seed: 17, aspectRatio: "16:9" },
    { BHAI_IMAGE_WORKFLOW: "flux-schnell" }
  );
  assert.equal(workflow["1"].inputs.ckpt_name, "flux1-schnell-fp8.safetensors");
  assert.equal(workflow["3"].inputs.width, 1280);
  assert.equal(workflow["3"].inputs.height, 720);
  assert.equal(workflow["4"].inputs.steps, 4);
  assert.equal(workflow["4"].inputs.cfg, 1);
  assert.equal(workflow["4"].inputs.seed, 17);
  assert.equal(workflow["2"].inputs.text, "cinematic Indian village at golden hour");
});

test("ComfyUI workflow uses only server-controlled graph, never caller-provided nodes", () => {
  const workflow = buildComfyUIWorkflow(
    { prompt: "portrait", seed: 9 },
    { BHAI_IMAGE_WORKFLOW: "flux-schnell", COMFYUI_CHECKPOINT: "owned-model.safetensors" }
  );
  assert.equal(workflow["1"].inputs.ckpt_name, "owned-model.safetensors");
  assert.ok(workflow["7"]);
  assert.equal(Object.values(workflow).some(node => node.class_type === "ExecutePython"), false);
});

test("ComfyUI dimensions reject excessive or unaligned workloads", () => {
  assert.throws(
    () => buildComfyUIWorkflow({ prompt: "test", width: 2048, height: 2048 }, { BHAI_IMAGE_WORKFLOW: "flux-schnell" }),
    /Image width and height/
  );
  assert.throws(
    () => buildComfyUIWorkflow({ prompt: "test", width: 1004, height: 768 }, { BHAI_IMAGE_WORKFLOW: "flux-schnell" }),
    /Image width and height/
  );
});

test("self-hosted ComfyUI polling returns only validated image bytes", async () => {
  const { generateComfyUIImage } = await import("../src/image.js");
  const png = Buffer.alloc(32);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(png, 0);
  let calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    if (String(url).endsWith("/prompt")) {
      const payload = JSON.parse(options.body);
      assert.equal(payload.prompt["1"].inputs.ckpt_name, "flux1-schnell-fp8.safetensors");
      return { ok:true, status:200, text:async()=>JSON.stringify({prompt_id:"prompt-1"}) };
    }
    if (String(url).includes("/history/prompt-1")) {
      return { ok:true, status:200, text:async()=>JSON.stringify({
        "prompt-1": {status:{status_str:"success",completed:true},outputs:{"7":{images:[{filename:"bhai_00001_.png",subfolder:"",type:"output"}]}}}
      }) };
    }
    if (String(url).includes("/view?")) {
      return {ok:true,status:200,headers:{get:()=> "image/png"},arrayBuffer:async()=>png.buffer.slice(png.byteOffset,png.byteOffset+png.byteLength)};
    }
    throw new Error("Unexpected URL");
  };
  const result = await generateComfyUIImage({
    url:"http://image-engine:8188",
    request:{prompt:"A cinematic village",seed:123,aspectRatio:"16:9"},
    timeoutMs:1500,
    fetchImpl,
    env:{BHAI_IMAGE_WORKFLOW:"flux-schnell"}
  });
  assert.equal(result.provider,"comfyui");
  assert.equal(result.promptId,"prompt-1");
  assert.equal(result.status,"completed");
  assert.equal(result.output.mimeType,"image/png");
  assert.equal(Buffer.from(result.output.data,"base64").subarray(0,8).toString("hex"),"89504e470d0a1a0a");
  assert.deepEqual(calls.map(c=>c.method),["POST","GET","GET"]);
});

test("image generation fails clearly when the self-hosted engine is not configured", async () => {
  await assert.rejects(
    () => submitComfyUI({ url: "", request: { prompt: "test", seed: 1 } }),
    error => error.status === 503 && /COMFYUI_URL/.test(error.message)
  );
});
