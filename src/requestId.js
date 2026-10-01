import crypto from "node:crypto";

export function requestId(req) {
  const incoming = req.headers["x-request-id"];
  if (incoming && /^[A-Za-z0-9._:-]{1,100}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}
