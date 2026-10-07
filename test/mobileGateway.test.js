import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createMobileGateway } from "../mobile-gateway/server.mjs";

function listen(server) {
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise(resolve => server.close(() => resolve()));
}

test("mobile gateway authenticates and forwards OpenAI-compatible engine routes", async () => {
  const engine = http.createServer(async (req, res) => {
    if (req.url === "/v1/models" && req.headers.authorization === "Bearer engine-secret") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ data: [{ id: "smollm2.gguf" }] }));
    }
    if (req.url === "/v1/chat/completions" && req.headers.authorization === "Bearer engine-secret") {
      let body = "";
      for await (const chunk of req) body += chunk;
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ choices: [{ message: { content: JSON.parse(body).messages[0].content } }] }));
    }
    res.statusCode = 401;
    res.end("unauthorized");
  });
  const enginePort = await listen(engine);
  const gateway = createMobileGateway({
    host: "127.0.0.1",
    port: 0,
    token: "gateway-secret",
    engineKey: "engine-secret",
    engineUrl: `http://127.0.0.1:${enginePort}`,
    maxConcurrent: 2
  });
  await new Promise((resolve, reject) => {
    gateway.server.once("error", reject);
    gateway.server.listen(0, "127.0.0.1", resolve);
  });
  const gatewayPort = gateway.server.address().port;

  try {
    const unauthorized = await fetch(`http://127.0.0.1:${gatewayPort}/v1/models`);
    assert.equal(unauthorized.status, 401);

    const models = await fetch(`http://127.0.0.1:${gatewayPort}/v1/models`, {
      headers: { authorization: "Bearer gateway-secret" }
    });
    assert.equal(models.status, 200);
    assert.match(await models.text(), /smollm2\.gguf/);

    const chat = await fetch(`http://127.0.0.1:${gatewayPort}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer gateway-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] })
    });
    assert.equal(chat.status, 200);
    assert.match(await chat.text(), /hello/);
  } finally {
    await gateway.stop();
    await close(engine);
  }
});
