import test from "node:test";
import assert from "node:assert/strict";
import { probeLocalImageEngine } from "../mobile-node/localEngineProbe.mjs";

test("Local Dream probe includes its dedicated bearer key and accepts a healthy response", async () => {
  let request;
  const ready = await probeLocalImageEngine({
    url: "http://127.0.0.1:8081/",
    apiKey: "local-image-test-key",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { status: 200 };
    }
  });
  assert.equal(ready, true);
  assert.equal(request.url, "http://127.0.0.1:8081/tokenize");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.authorization, "Bearer local-image-test-key");
  assert.deepEqual(JSON.parse(request.options.body), { prompt: "bhai image probe" });
});

test("Local Dream probe does not report ready for an unauthorized engine", async () => {
  const ready = await probeLocalImageEngine({
    url: "http://127.0.0.1:8081",
    apiKey: "wrong-key",
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.authorization, "Bearer wrong-key");
      return { status: 401 };
    }
  });
  assert.equal(ready, false);
});

test("Local Dream probe remains not ready when the engine cannot be reached", async () => {
  const ready = await probeLocalImageEngine({
    url: "http://127.0.0.1:8081",
    fetchImpl: async () => { throw new Error("ECONNREFUSED"); }
  });
  assert.equal(ready, false);
});

test("Local Dream probe returns not ready when the URL is missing", async () => {
  assert.equal(await probeLocalImageEngine({ url: "" }), false);
});
