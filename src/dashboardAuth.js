import crypto from "node:crypto";

const COOKIE_NAME = "bhai_core_session";
const MAX_AGE_SECONDS = 8 * 60 * 60;

function secret() {
  return process.env.BHAI_CORE_PASSWORD || "";
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

function encode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function equal(left, right) {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

export function sessionCookie(username) {
  const payload = encode(JSON.stringify({ username, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS }));
  return `${COOKIE_NAME}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

export function authenticateSession(req, username) {
  if (!secret() || !username) return false;
  const raw = String(req.headers.cookie || "");
  const match = raw.split(";").map(v => v.trim()).find(v => v.startsWith(COOKIE_NAME + "="));
  if (!match) return false;
  const token = match.slice(COOKIE_NAME.length + 1);
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!equal(signature, sign(payload))) return false;
  try {
    const data = JSON.parse(decode(payload));
    return data.username === username && Number(data.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
