const REQUEST_PATH = "/v1/relay/request";
const MAX_BODY = 192 * 1024;
const MAX_PATH = 2048;
const MAX_HEADERS = 64;
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function validPath(path) {
  return typeof path === "string"
    && path.length > 0
    && path.length <= MAX_PATH
    && path.startsWith("/v1/");
}

function validHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return false;
  return Object.keys(headers).length <= MAX_HEADERS
    && Object.entries(headers).every(([key, value]) =>
      typeof key === "string"
      && key.length > 0
      && key.length <= 128
      && /^[!#$%&'*+.^_|~0-9A-Za-z-]+$/.test(key)
      && (typeof value === "string" || Array.isArray(value))
      && String(value).length <= 8192
    );
}

function relayConfig() {
  const url = String(process.env.BHAI_MOBILE_RELAY_URL || "").trim().replace(/\/+$/, "");
  const token = String(process.env.BHAI_MOBILE_RELAY_CLIENT_TOKEN || "").trim();
  return { url, token };
}

export function mobileRelayInfo() {
  const { url, token } = relayConfig();
  return {
    configured: Boolean(url && token),
    url_configured: Boolean(url),
    token_configured: Boolean(token)
  };
}

export async function requestMobileRelay({
  path,
  method = "GET",
  headers = {},
  body = null,
  signal
} = {}) {
  const { url, token } = relayConfig();
  if (!url || !token) {
    throw Object.assign(new Error("BHAI mobile relay is not configured"), { status: 503 });
  }

  const normalizedMethod = String(method || "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(normalizedMethod) || !validPath(path) || !validHeaders(headers)) {
    throw Object.assign(new Error("Invalid mobile relay request"), { status: 400 });
  }
  if (body !== null && String(body).length > MAX_BODY) {
    throw Object.assign(new Error("Mobile relay request body too large"), { status: 413 });
  }

  const safeHeaders = { ...headers };
  delete safeHeaders.authorization;
  delete safeHeaders.Authorization;

  const response = await fetch(url + REQUEST_PATH, {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json"
    },
    body: JSON.stringify({ method: normalizedMethod, path, headers: safeHeaders, body }),
    signal
  });

  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { data = { error: raw || "Invalid relay response" }; }

  if (!response.ok) {
    throw Object.assign(
      new Error(String(data?.error || data?.message || "Mobile relay HTTP " + response.status)),
      { status: response.status }
    );
  }

  const status = Number(data?.status) || 502;
  const responseBody = String(data?.body || "");
  if (responseBody.length > MAX_BODY) {
    throw Object.assign(new Error("Mobile relay response body too large"), { status: 502 });
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => responseBody
  };
}
