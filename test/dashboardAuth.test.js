import test from "node:test";
import assert from "node:assert/strict";
import { sessionCookie, clearSessionCookie, authenticateSession } from "../src/dashboardAuth.js";

test("dashboard session cookie authenticates the configured user", () => {
  const previous = process.env.BHAI_CORE_PASSWORD;
  process.env.BHAI_CORE_PASSWORD = "test-secret";

  const cookie = sessionCookie("admin");
  const request = { headers: { cookie } };

  assert.match(cookie, /^bhai_core_session=/);
  assert.equal(authenticateSession(request, "admin"), true);
  assert.equal(authenticateSession(request, "other"), false);

  if (previous === undefined) delete process.env.BHAI_CORE_PASSWORD;
  else process.env.BHAI_CORE_PASSWORD = previous;
});

test("dashboard session rejects tampering and expiry", () => {
  const previous = process.env.BHAI_CORE_PASSWORD;
  process.env.BHAI_CORE_PASSWORD = "test-secret";

  const cookie = sessionCookie("admin");
  const token = cookie.split(";")[0];
  const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
  assert.equal(authenticateSession({ headers: { cookie: tampered } }, "admin"), false);
  assert.match(clearSessionCookie(), /Max-Age=0/);

  if (previous === undefined) delete process.env.BHAI_CORE_PASSWORD;
  else process.env.BHAI_CORE_PASSWORD = previous;
});
