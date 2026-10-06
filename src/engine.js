import { requestMobileNode } from "./mobileNode.js";
function timeoutSignal(ms = 60000) {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

function endpoint(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("BHAI engine URL is not configured");
  if (isMobileTarget(base)) return "/v1/chat/completions";
  return base.endsWith("/v1") ? base + "/chat/completions" : base + "/v1/chat/completions";
}

function modelsEndpoint(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("BHAI engine URL is not configured");
  if (isMobileTarget(base)) return "/v1/models";
  return base.endsWith("/v1") ? base + "/models" : base + "/v1/models";
}

function headers(key) {
  const result = { "content-type": "application/json" };
  if (key) result.authorization = "Bearer " + key;
  return result;
}

function isMobileTarget(url) {
  return String(url || "").startsWith("mobile://");
}

async function requestTarget(target, path, options = {}) {
  if (!isMobileTarget(target.url)) {
    return fetch(path, options);
  }
  // The mobile node owns authentication to the local engine.
  // Do not forward BHAI-CORE's engine key to the phone; the node injects
  // its local Authorization header before calling llama-server.
  const forwardedHeaders = { ...(options.headers || {}) };
  delete forwardedHeaders.authorization;
  delete forwardedHeaders.Authorization;
  return requestMobileNode({
    path: String(path || "/"),
    method: options.method || "GET",
    headers: forwardedHeaders,
    body: options.body || null
  });
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
  let firstReachableMismatch = null;

  for (const target of targets) {
    try {
      const response = await requestTarget(target, modelsEndpoint(target.url), {
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

      if (!firstReachableMismatch) {
        firstReachableMismatch = {
          ok: false,
          reachable: true,
          model: targetModel,
          model_available: false,
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

  if (firstReachableMismatch) return firstReachableMismatch;

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
      const localModel = /smollm2/i.test(String(target.model || ""));
      const sourceMessages = Array.isArray(config.messages) ? config.messages : [];
      // SmolLM2 135M is intentionally kept in a compact prompt mode. Large
      // BHAI-X system/tool context overwhelms this tiny local model and can
      // produce prompt-copy/garbled tokens. Preserve the latest user request.
      const messages = localModel
        ? sourceMessages.filter(m => m?.role === "user").slice(-1)
        : sourceMessages;
      const response = await requestTarget(target, endpoint(target.url), {
        method: "POST",
        headers: headers(target.key),
        body: JSON.stringify({
          model: target.model,
          messages,
          temperature: localModel ? 0 : (config.temperature ?? 0.2),
          max_tokens: localModel ? Math.min(Number(config.max_tokens ?? 64), 64) : (config.max_tokens ?? 256),
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
      const localModel = /smollm2/i.test(String(target.model || ""));
      const sourceMessages = Array.isArray(config.messages) ? config.messages : [];
      // Keep the streaming path identical to the proven non-streaming
      // local SmolLM2 path: only the latest user turn and greedy decoding.
      const messages = localModel
        ? sourceMessages.filter(m => m?.role === "user").slice(-1)
        : sourceMessages;
      const response = await requestTarget(target, endpoint(target.url), {
        method: "POST",
        headers: headers(target.key),
        body: JSON.stringify({
          model: target.model,
          messages,
          temperature: localModel ? 0 : (config.temperature ?? 0.2),
          max_tokens: localModel ? Math.min(Number(config.max_tokens ?? 64), 64) : (config.max_tokens ?? 256),
          stream: true
        }),
        signal: timeoutSignal()
      });

      if (!response.ok) await readJson(response);

      if (isMobileTarget(target.url)) {
        const raw = await response.text();
        const lines = String(raw).split("\n");
        let fullText = "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const data = JSON.parse(payload);
            const token = data?.choices?.[0]?.delta?.content || data?.output?.delta || "";
            if (token) {
              emitted = true;
              fullText += token;
              await config.onToken(token);
            }
          } catch {}
        }
        if (!fullText) throw new Error("BHAI mobile engine returned no stream text");
        return {
          text: fullText,
          model: target.model,
          target_role: target.role,
          fallback_used: target.role === "fallback"
        };
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
