import test from "node:test";
import assert from "node:assert/strict";
import { selfHostedImageWorkerStatus } from "../src/imageWorker.js";

test("Local Dream worker stays disabled even if an old node reports it ready",()=>{
 const status=selfHostedImageWorkerStatus({
  connected:true,
  engines:[{id:"local-image",name:"Local Dream SD1.5",model:"sd1.5",backend:"local-dream",ready:true,loaded:true,capabilities:["image-text-to-image","gpu"]}]
 },{BHAI_IMAGE_WORKER_KEY:"configured"});
 assert.equal(status.ready,false);
 assert.equal(status.ok,false);
 assert.equal(status.reason,"quality_policy_disabled");
 assert.equal(status.replacement,"self-hosted-comfyui-gpu");
});

test("Local Dream worker never becomes ready from configuration alone",()=>{
 const status=selfHostedImageWorkerStatus(null,{BHAI_IMAGE_WORKER_KEY:"configured"});
 assert.equal(status.ready,false);
 assert.equal(status.reason,"quality_policy_disabled");
});
