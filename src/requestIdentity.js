function firstForwardedAddress(value) {
  return String(value || "").split(",")[0].trim();
}

export function clientAddress(req) {
  const headers = req?.headers || {};
  const cloudflare = String(headers["cf-connecting-ip"] || "").trim();
  if (cloudflare) return cloudflare;

  const forwarded = firstForwardedAddress(headers["x-forwarded-for"]);
  if (forwarded) return forwarded;

  return String(req?.socket?.remoteAddress || "anonymous");
}
