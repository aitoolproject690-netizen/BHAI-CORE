import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import WebSocket from "ws";
import { attachMobileNode, mobileNodeInfo, requestMobileNode } from "../src/mobileNode.js";

test("mobile node relay authenticates and forwards requests", async () => {
  process.env.BHAI_MOBILE_NODE_TOKEN = "relay-test-token";
  const server = http.createServer();
  attachMobileNode(server);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const client = new WebSocket("ws://127.0.0.1:" + port + "/v1/mobile-node");

  try {
    await new Promise((resolve, reject) => {
      client.once("error", reject);
      client.once("open", () => {
        client.send(JSON.stringify({ type: "auth", token: "relay-test-token" }));
      });
      client.once("message", raw => {
        const message = JSON.parse(String(raw));
        if (message.type !== "auth_ok") return reject(new Error("auth was not accepted"));
        resolve();
      });
    });

    assert.equal(mobileNodeInfo().connected, true);

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
  }
});
