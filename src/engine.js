function timeoutSignal(ms = 60000) {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

function endpoint(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("BHAI engine URL is not configured");
  return base.endsWith("/v1") ? base + "/chat/completions" : base + "/v1/chat/completions";
}

function modelsEndpoint(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("BHAI engine URL is not configured");
  return base.endsWith("/v1") ? base + "/models" : base + "/v1/models";
}

function headers(key) {
  const result = { "content-type": "application/json" };
  if (key) result.authorization = "Bearer " + key;
  return result;
}

export function engineTargets({
  url = "",
  key = "",
  model = "",
  fallbackUrl = "",
  fallbackKey = "",
  fallbackModel = ""
} = {}) {
  const targets = [];
  const push = (baseUrl, apiKey, targetModel, role) => {
    const cleanUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!cleanUrl) return;
    const item = {
      url: cleanUrl,
      key: String(apiKey || ""),
      model: String(targetModel || model || "bhai-local"),
      role
    };
    if (!targets.some(existing =>
      existing.url === item.url &&
      existing.key === item.key &&
      existing.model === item.model
    )) {
      targets.push(item);
    }
  };

  push(url, key, model, "primary");
  push(fallbackUrl, fallbackKey, fallbackModel || model, "fallback");
  return targets;
}

async function readJson(response) {
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(
      data?.error?.message ||
      data?.error ||
      data?.message ||
      data?.raw ||
      "BHAI engine HTTP " + response.status
    );
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function bhaiEngineProbe(config = {}) {
  const targets = engineTargets(config);
  if (!targets.length) throw new Error("BHAI engine URL is not configured");

  const errors = [];
  for (const target of targets) {
    try {
      const response = await fetch(modelsEndpoint(target.url), {
        method: "GET",
        headers: headers(target.key),
        signal: timeoutSignal()
      });
      const data = await readJson(response);
      const availableModels = Array.isArray(data?.data)
        ? data.data.map(item => String(item?.id || "")).filter(Boolean)
        : [];
      const targetModel = String(target.model || "").trim();
      const modelAvailable = Boolean(targetModel && availableModels.includes(targetModel));

      if (modelAvailable) {
        return {
          ok: true,
          reachable: true,
          model: targetModel,
          model_available: true,
          available_models: availableModels.slice(0, 20),
          target_role: target.role,
          fallback_used: target.role === "fallback"
        };
      }

      errors.push(target.role + ": model unavailable");
    } catch (error) {
      errors.push(target.role + ": " + String(error?.message || error).slice(0, 240));
    }
  }

  const error = new Error("All BHAI engine targets failed: " + errors.join(" | "));
  error.status = 503;
  throw error;
}

export async function bhaiEngineChat(config = {}) {
  const targets = engineTargets(config);
  if (!targets.length) throw new Error("BHAI engine URL is not configured");

  const errors = [];
  for (const target of targets) {
    try {
      const response = await fetch(endpoint(target.url), {
        method: "POST",
        headers: headers(target.key),
        body: JSON.stringify({
          model: target.model,
          messages: config.messages,
          temperature: config.temperature ?? 0.7,
          stream: false
        }),
        signal: timeoutSignal()
      });
      const data = await readJson(response);
      const text = data?.choices?.[0]?.message?.content || data?.output?.text || data?.text || "";
      if (!text) throw new Error("BHAI engine returned no text");
      return {
        text,
        model: target.model,
        raw: data,
        target_role: target.role,
        fallback_used: target.role === "fallback"
      };
    } catch (error) {
      errors.push(target.role + ": " + String(error?.message || error).slice(0, 240));
    }
  }

  const error = new Error("All BHAI engine targets failed: " + errors.join(" | "));
  error.status = 503;
  throw error;
}

export async function bhaiEngineChatStream(config = {}) {
  if (typeof config.onToken !== "function") throw new Error("onToken callback is required");
  const targets = engineTargets(config);
  if (!targets.length) throw new Error("BHAI engine URL is not configured");

  const errors = [];

  for (const target of targets) {
    let emitted = false;
    try {
      const response = await fetch(endpoint(target.url), {
        method: "POST",
        headers: headers(target.key),
        body: JSON.stringify({
          model: target.model,
          messages: config.messages,
          temperature: config.temperature ?? 0.7,
          stream: true
        }),
        signal: timeoutSignal()
      });

      if (!response.ok) await readJson(response);
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
            emitted = true;
            fullText += token;
            await config.onToken(token);
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

      return {
        text: fullText,
        model: target.model,
        target_role: target.role,
        fallback_used: target.role === "fallback"
      };
    } catch (error) {
      if (emitted) throw error;
      errors.push(target.role + ": " + String(error?.message || error).slice(0, 240));
    }
  }

  const error = new Error("All BHAI engine targets failed: " + errors.join(" | "));
  error.status = 503;
  throw error;
}

export function engineInfo({ url = "", model = "", fallbackUrl = "", fallbackModel = "" } = {}) {
  const targets = engineTargets({ url, model, fallbackUrl, fallbackModel });
  return {
    configured: targets.length > 0,
    url_configured: Boolean(String(url).trim()),
    fallback_configured: Boolean(String(fallbackUrl).trim()),
    target_count: targets.length,
    model: String(model || fallbackModel || "")
  };
}
