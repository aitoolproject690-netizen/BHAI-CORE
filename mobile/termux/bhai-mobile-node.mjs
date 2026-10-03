import http from "node:http";

const HOST = process.env.BHAI_MOBILE_HOST || "127.0.0.1";
const PORT = Number(process.env.BHAI_MOBILE_PORT || 8090);
const UPSTREAM_HOST = process.env.LLAMA_SERVER_HOST || "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.LLAMA_SERVER_PORT || 8080);
const API_KEY = String(process.env.BHAI_MOBILE_API_KEY || "").trim();
const MAX_BODY = 2 * 1024 * 1024;

if (!API_KEY || API_KEY === "change-this-before-starting") {
  throw new Error("BHAI_MOBILE_API_KEY must be configured before starting the mobile node");
}

function authorized(req) {
  const key = String(req.headers["x-bhai-key"] || "").trim();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  return key === API_KEY || bearer === API_KEY;
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > MAX_BODY) {
        reject(Object.assign(new Error("request body too large"), { code: "BODY_TOO_LARGE" }));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function proxy(req, res) {
  const upstream = http.request({
    hostname: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    path: req.url,
    method: req.method,
    headers: {
      "content-type": req.headers["content-type"] || "application/json",
      "accept": req.headers.accept || "application/json"
    }
  }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode || 502, {
      "content-type": upstreamRes.headers["content-type"] || "application/json",
      "cache-control": "no-store"
    });
    upstreamRes.pipe(res);
  });

  upstream.setTimeout(60_000, () => upstream.destroy(new Error("llama-server timeout")));
  upstream.on("error", err => {
    if (!res.headersSent) send(res, 503, { error: "mobile inference backend unavailable", detail: err.message });
    else res.destroy(err);
  });

  if (req.method === "GET" || req.method === "HEAD") {
    upstream.end();
    return;
  }

  readBody(req)
    .then(body => upstream.end(body))
    .catch(err => {
      upstream.destroy();
      if (!res.headersSent) send(res, err.code === "BODY_TOO_LARGE" ? 413 : 400, { error: err.message });
    });
}

const server = http.createServer((req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    return send(res, 200, { ok: true, service: "BHAI Mobile Node", runtime: "android-termux" });
  }

  if (!authorized(req)) return send(res, 401, { error: "BHAI mobile API key required" });
  if (req.url === "/ready" && req.method === "GET") return proxy(req, res);
  if (req.url === "/v1/models" && req.method === "GET") return proxy(req, res);
  if (req.url === "/v1/chat/completions" && req.method === "POST") return proxy(req, res);

  return send(res, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    event: "mobile_node_listening",
    host: HOST,
    port: PORT,
    upstream: "http://" + UPSTREAM_HOST + ":" + UPSTREAM_PORT
  }));
});
