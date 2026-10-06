import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocket } from "ws";
import { attachMobileNode, mobileNodeInfo, requestMobileNode } from "../src/mobileNode.js";

test("mobile relay v1 authenticates and relays a bounded request", async () => {
  const previousToken = process.env.BHAI_MOBILE_NODE_TOKEN;
  const token = "relay-test-token";
  process.env.BHAI_MOBILE_NODE_TOKEN = token;

  const server = http.createServer();
  attachMobileNode(server);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/mobile-node`);

  try {
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    ws.send(JSON.stringify({ type: "auth", token }));

    const authOk = await new Promise((resolve, reject) => {
      const onMessage = raw => {
        const message = JSON.parse(raw.toString());
        if (message.type === "auth_ok") {
          ws.off("message", onMessage);
          resolve(message);
        }
      };
      ws.on("message", onMessage);
      ws.once("error", reject);
    });

    assert.equal(authOk.type, "auth_ok");
    assert.equal(mobileNodeInfo().connected, true);

    const requestPromise = requestMobileNode({
      path: "/v1/models",
      method: "GET",
      headers: { "x-test": "relay" }
    });

    const relayRequest = await new Promise((resolve, reject) => {
      const onMessage = raw => {
        const message = JSON.parse(raw.toString());
        if (message.type === "request") {
          ws.off("message", onMessage);
          resolve(message);
        }
      };
      ws.on("message", onMessage);
      ws.once("error", reject);
    });

    assert.equal(relayRequest.method, "GET");
    assert.equal(relayRequest.path, "/v1/models");
    assert.equal(relayRequest.headers["x-test"], "relay");

    ws.send(JSON.stringify({
      type: "response",
      id: relayRequest.id,
      ok: true,
      status: 200,
      text: JSON.stringify({ ok: true, source: "mobile-node-test" })
    }));

    const response = await requestPromise;
    assert.equal(response.ok, true);
    assert.equal(response.status, 200);
    assert.match(response.text, /mobile-node-test/);
  } finally {
    ws.close();
    await new Promise(resolve => setTimeout(resolve, 50));
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (previousToken === undefined) delete process.env.BHAI_MOBILE_NODE_TOKEN;
    else process.env.BHAI_MOBILE_NODE_TOKEN = previousToken;
  }
});
