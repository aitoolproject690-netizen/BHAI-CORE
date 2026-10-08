import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import WebSocket from "ws";
import { attachMobileNode, mobileNodeInfo, requestMobileNode } from "../src/mobileNode.js";

test("mobile node relay authenticates and forwards requests", async () => {
  process.env.BHAI_MOBILE_NODE_TOKEN = "relay-test-token";
  process.env.BHAI_MOBILE_NODE_ID = "oneplus-12r";
  const server = http.createServer();
  attachMobileNode(server);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const client = new WebSocket("ws://127.0.0.1:" + port + "/v1/mobile-node");

  try {
    await new Promise((resolve, reject) => {
      client.once("error", reject);
      client.once("open", () => {
        client.send(JSON.stringify({
          type: "auth",
          token: "relay-test-token",
          nodeId: "oneplus-12r",
          model: "smollm2.gguf",
          capabilities: ["chat", "gpu", "vulkan"],
          platform: "android-termux",
          version: "1.1.0"
        }));
      });
      client.once("message", raw => {
        const message = JSON.parse(String(raw));
        if (message.type !== "auth_ok") return reject(new Error("auth was not accepted"));
        assert.equal(message.nodeId, "oneplus-12r");
        assert.equal(message.pairedBy, "token+node-id");
        resolve();
      });
    });

    assert.equal(mobileNodeInfo().connected, true);
    assert.equal(mobileNodeInfo().paired, true);
    assert.equal(mobileNodeInfo().nodeId, "oneplus-12r");
    assert.equal(mobileNodeInfo().model, "smollm2.gguf");
    assert.deepEqual(mobileNodeInfo().capabilities, ["chat", "gpu", "vulkan"]);
    assert.equal(mobileNodeInfo().pairingMode, "token+node-id");

    const responsePromise = requestMobileNode({
      path: "/v1/models",
      method: "GET",
      headers: { authorization: "Bearer relay-test-token" }
    });

    const request = await new Promise((resolve, reject) => {
      const onMessage = raw => {
        const message = JSON.parse(String(raw));
        if (message.type === "request") {
          client.off("message", onMessage);
          resolve(message);
        }
      };
      client.on("message", onMessage);
      client.once("error", reject);
    });

    assert.equal(request.path, "/v1/models");
    client.send(JSON.stringify({
      type: "response",
      id: request.id,
      status: 200,
      body: JSON.stringify({ data: [{ id: "smollm2.gguf" }] })
    }));

    const response = await responsePromise;
    assert.equal(response.ok, true);
    assert.match(await response.text(), /smollm2\.gguf/);
  } finally {
    client.close();
    await new Promise(resolve => server.close(resolve));
    delete process.env.BHAI_MOBILE_NODE_TOKEN;
    delete process.env.BHAI_MOBILE_NODE_ID;
  }
});
