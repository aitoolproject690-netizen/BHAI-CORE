function timeoutSignal(ms = 60000) {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

function endpoint(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("BHAI_ENGINE_URL is not configured");
  return base.endsWith("/v1") ? base + "/chat/completions" : base + "/v1/chat/completions";
}

function modelsEndpoint(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("BHAI_ENGINE_URL is not configured");
  return base.endsWith("/v1") ? base + "/models" : base + "/v1/models";
}

function headers(key) {
  const result = { "content-type": "application/json" };
  if (key) result.authorization = "Bearer " + key;
  return result;
}

async function readJson(response) {
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.error || data?.message || data?.raw || "BHAI engine HTTP " + response.status);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function bhaiEngineProbe({ url, key, model }) {
  const response = await fetch(modelsEndpoint(url), {
    method: "GET",
    headers: headers(key),
    signal: timeoutSignal()
  });
  const data = await readJson(response);
  const availableModels = Array.isArray(data?.data)
    ? data.data.map(item => String(item?.id || "")).filter(Boolean)
    : [];
  const targetModel = String(model || "").trim();
  const modelAvailable = Boolean(targetModel && availableModels.includes(targetModel));
  return {
    ok: response.ok && modelAvailable,
    reachable: true,
    model: targetModel,
    model_available: modelAvailable,
    available_models: availableModels.slice(0, 20)
  };
}

export async function bhaiEngineChat({ url, key, model, messages, temperature = 0.7 }) {
  const response = await fetch(endpoint(url), {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({ model, messages, temperature, stream: false }),
    signal: timeoutSignal()
  });
  const data = await readJson(response);
  const text = data?.choices?.[0]?.message?.content || data?.output?.text || data?.text || "";
  if (!text) throw new Error("BHAI engine returned no text");
  return { text, raw: data };
}

export async function bhaiEngineChatStream({ url, key, model, messages, temperature = 0.7, onToken }) {
  if (typeof onToken !== "function") throw new Error("onToken callback is required");
  const response = await fetch(endpoint(url), {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({ model, messages, temperature, stream: true }),
    signal: timeoutSignal()
  });
  if (!response.ok) {
    await readJson(response);
  }
  if (!response.body) throw new Error("BHAI engine returned no stream body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  const emit = async line => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const data = JSON.parse(payload);
      const token = data?.choices?.[0]?.delta?.content || data?.output?.delta || "";
      if (token) {
        fullText += token;
        await onToken(token);
      }
    } catch {}
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) await emit(line.trim());
  }

  buffer += decoder.decode();
  for (const line of buffer.split("\n")) await emit(line.trim());
  if (!fullText) throw new Error("BHAI engine returned no stream text");
  return { text: fullText };
}

export function engineInfo({ url = "", model = "" } = {}) {
  return {
    configured: Boolean(String(url).trim() && String(model).trim()),
    url_configured: Boolean(String(url).trim()),
    model: String(model || "")
  };
}
