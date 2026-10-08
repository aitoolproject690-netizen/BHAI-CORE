import test from "node:test";
import assert from "node:assert/strict";
import { updateMobileEngineRegistry, mobileEngineInfo, selectMobileEngine } from "../src/mobileEngines.js";

test("mobile engine registry selects ready local capability", () => {
  updateMobileEngineRegistry([
    { id:"llm", name:"SmolLM2", kind:"llm", model:"smollm2.gguf", backend:"llama.cpp-vulkan", capabilities:["chat"], ready:true, loaded:true, memory_mb:512 },
    { id:"image", name:"Local Image", kind:"image", model:"image-local-v1", backend:"vulkan", capabilities:["image-text-to-image"], ready:true, loaded:false, memory_mb:2400 }
  ]);
  const info=mobileEngineInfo();
  assert.equal(info.count,2);
  assert.equal(selectMobileEngine({capability:"image-text-to-image"}).id,"image");
  updateMobileEngineRegistry([]);
  assert.equal(mobileEngineInfo().count,0);
});
