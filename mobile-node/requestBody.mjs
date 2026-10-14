// llama.cpp may reuse a stale prompt/KV prefix and emit repeated garbage tokens.
// Force a fresh prompt evaluation for mobile text-completion requests.
export function prepareLocalTextRequestBody(path, method, body) {
  const verb = String(method || "GET").toUpperCase();
  const route = String(path || "");
  const isTextCompletion =
    route === "/completion" ||
    route === "/v1/chat/completions" ||
    route === "/v1/chat/completions/stream";
  if (verb !== "POST" || !isTextCompletion || typeof body !== "string" || !body.trim()) {
    return body;
  }

  try {
    const payload = JSON.parse(body);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return body;
    // Do not allow a caller to re-enable prompt-cache reuse on the phone runtime.
    payload.cache_prompt = false;
    return JSON.stringify(payload);
  } catch {
    // Leave malformed/non-JSON requests unchanged so the upstream returns its normal error.
    return body;
  }
}
