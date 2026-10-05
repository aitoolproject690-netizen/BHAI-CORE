import test from "node:test";
import assert from "node:assert/strict";
import { clientAddress } from "../src/requestIdentity.js";

test("clientAddress prefers Cloudflare's canonical client IP header", () => {
  assert.equal(clientAddress({
    headers: {
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.20, 10.0.0.1"
    },
    socket: { remoteAddress: "127.0.0.1" }
  }), "203.0.113.10");
});

test("clientAddress falls back to the first X-Forwarded-For address", () => {
  assert.equal(clientAddress({
    headers: { "x-forwarded-for": "198.51.100.20, 10.0.0.1" },
    socket: { remoteAddress: "127.0.0.1" }
  }), "198.51.100.20");
});

test("clientAddress falls back to the socket address", () => {
  assert.equal(clientAddress({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }), "127.0.0.1");
});
