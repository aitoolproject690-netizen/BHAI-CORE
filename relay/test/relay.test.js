import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createRelayServer, REQUEST_PATH, RELAY_PATH } from "../server.js";

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

function waitForMessage(ws) {
  return new Promise((resolve, reject) => {
    const onMessage = raw => {
      cleanup();
      resolve(JSON.parse(String(raw)));
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      ws.off("message", onMessage);
      ws.off("error", onError);
    };
    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

async function post(base, token, payload) {
  const response = await fetch(base + REQUEST_PATH, {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return {
    status: response.status,
    body: await response.json()
  };
}

test("BHAI relay authenticates a node and proxies a request", async t => {
  const relay = createRelayServer({
    host: "127.0.0.1",
    port: 0,
    nodeToken: "node-secret",
    clientToken: "client-secret"
  });
  t.after(() => relay.stop());
  const address = await relay.start();
  const base = "http://127.0.0.1:" + address.port;

  const ws = new WebSocket(base.replace("http://", "ws://") + RELAY_PATH);
  t.after(() => ws.close());

  await waitForOpen(ws);
  ws.send(JSON.stringify({ type: "auth", token: "node-secret" }));
  assert.deepEqual(await waitForMessage(ws), { type: "auth_ok" });

  const resultPromise = post(base, "client-secret", {
    path: "/v1/models",
    method: "GET",
    headers: {}
  });

  const request = await waitForMessage(ws);
  assert.equal(request.type, "request");
  assert.equal(request.path, "/v1/models");

  ws.send(JSON.stringify({
    type: "response",
    id: request.id,
    status: 200,
    body: '{"ok":true}'
  }));

  const result = await resultPromise;
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    status: 200,
    body: '{"ok":true}'
  });
});

test("BHAI relay rejects unauthorized client requests", async t => {
  const relay = createRelayServer({
    host: "127.0.0.1",
    port: 0,
    nodeToken: "node-secret",
    clientToken: "client-secret"
  });
  t.after(() => relay.stop());
  const address = await relay.start();
  const result = await post("http://127.0.0.1:" + address.port, "wrong", {
    path: "/v1/models",
    method: "GET",
    headers: {}
  });
  assert.equal(result.status, 401);
  assert.equal(result.body.error, "authentication_required");
});
