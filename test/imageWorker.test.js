import test from "node:test";
import assert from "node:assert/strict";
import { selfHostedImageWorkerStatus } from "../src/imageWorker.js";
const env = { BHAI_IMAGE_WORKER_KEY: "test-worker-secret" };
const readyNode = { connected: true, engines: [{ id:"local-image", name:"Local Dream SD1.5",
  model:"sd1.5", backend:"local-dream", ready:true, loaded:true,
  capabilities:["image-text-to-image","gpu"] }] };
test("image worker requires configured key and probed Local Dream engine",()=>{
 assert.equal(selfHostedImageWorkerStatus(readyNode,env).ready,true);
 assert.equal(selfHostedImageWorkerStatus(readyNode,{}).reason,"worker_key_not_configured");
});
test("image worker is not ready when phone node disconnects",()=>{
 assert.equal(selfHostedImageWorkerStatus({...readyNode,connected:false},env).reason,"mobile_node_disconnected");
});
test("image worker is not ready if model probe fails",()=>{
 const node={...readyNode,engines:readyNode.engines.map(e=>({...e,ready:false}))};
 assert.equal(selfHostedImageWorkerStatus(node,env).reason,"local_dream_probe_failed");
});
