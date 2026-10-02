import test from "node:test";
import assert from "node:assert/strict";
import { authenticateMaster, masterAuthInfo } from "../src/masterAuth.js";

function requestWith(username, password) {
  const token = Buffer.from(username + ":" + password).toString("base64");
  return { headers: { authorization: "Basic " + token } };
}

test("master auth is disabled when no credentials are configured", () => {
  assert.deepEqual(masterAuthInfo("", ""), { enabled: false, username: "" });
});

test("master auth requires both username and password", () => {
  assert.throws(() => masterAuthInfo("owner", ""), /must both be configured/);
  assert.throws(() => masterAuthInfo("", "secret"), /must both be configured/);
});

test("master auth accepts only exact Basic credentials", () => {
  const req = requestWith("owner", "secret");
  assert.equal(authenticateMaster(req, "owner", "secret"), true);
  assert.equal(authenticateMaster(req, "owner", "wrong"), false);
  assert.equal(authenticateMaster(requestWith("other", "secret"), "owner", "secret"), false);
  assert.equal(authenticateMaster({ headers: {} }, "owner", "secret"), false);
});
