import crypto from "node:crypto";

function equalSecret(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string" || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function masterAuthInfo(username, password) {
  const configured = Boolean(username || password);
  if (!configured) return { enabled: false, username: "" };
  if (!username || !password) {
    throw Object.assign(new Error("BHAI_CORE_USERNAME and BHAI_CORE_PASSWORD must both be configured"), {
      code: "CONFIG_MASTER_AUTH_INVALID",
      status: 500
    });
  }
  return { enabled: true, username };
}

export function authenticateMaster(req, username, password) {
  if (!username || !password) return false;
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Basic ")) return false;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  const providedUser = decoded.slice(0, separator);
  const providedPassword = decoded.slice(separator + 1);
  return equalSecret(providedUser, username) && equalSecret(providedPassword, password);
}
