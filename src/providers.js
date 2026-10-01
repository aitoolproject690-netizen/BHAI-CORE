function timeoutSignal(ms = 30000) {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

async function jsonFetch(url, options, timeoutMs = 30000) {
  const response = await fetch(url, { ...options, signal: timeoutSignal(timeoutMs) });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.error || data?.message || data?.raw || "HTTP " + response.status);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function openAICompatibleStream(url, headers, body, onToken, timeoutMs = 60000) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, stream: true }),
    signal: timeoutSignal(timeoutMs)
  });
  if (!response.ok) {
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    const error = new Error(data?.error?.message || data?.error || data?.message || data?.raw || "HTTP " + response.status);
    error.status = response.status;
    throw error;
  }
  if (!response.body) throw new Error("Provider returned no stream body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload);
        const token = data?.choices?.[0]?.delta?.content || "";
        if (token) {
          fullText += token;
          await onToken(token);
        }
      } catch {}
    }
  }
  return fullText;
}

async function ollamaChat({ url, model, messages, temperature = 0.7 }) {
  const baseUrl = String(url || "http://127.0.0.1:11434").replace(/\\/$/, "");
  const data = await jsonFetch(baseUrl + "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false, options: { temperature } })
  });
  const text = data?.message?.content || "";
  if (!text) throw new Error("Ollama returned no text");
  return { text, raw: data };
}

async function ollamaChatStream({ url, model, messages, temperature = 0.7, onToken }) {
  const baseUrl = String(url || "http://127.0.0.1:11434").replace(/\\/$/, "");
  const response = await fetch(baseUrl + "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true, options: { temperature } }),
    signal: timeoutSignal(60000)
  });
  if (!response.ok) {
    const error = new Error(await response.text());
    error.status = response.status;
    throw error;
  }
  if (!response.body) throw new Error("Ollama returned no stream body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", fullText = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\\n");
    buffer = lines.pop() || "";
    for (const rawLine of lines) {
      if (!rawLine.trim()) continue;
      try {
        const data = JSON.parse(rawLine);
        const token = data?.message?.content || "";
        if (token) { fullText += token; await onToken(token); }
      } catch {}
    }
  }
  return { text: fullText };
}

export const providerAdapters = {
  async ollama({ url, model, messages, temperature = 0.7 }) {
    return ollamaChat({ url, model, messages, temperature });
  },
  async gemini({ key, model, messages, temperature = 0.7 }) {
    const contents = messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content ?? "") }] }));
    const data = await jsonFetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key), {
      method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({contents,generationConfig:{temperature}})
    });
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    if (!text) throw new Error("Gemini returned no text");
    return {text,raw:data};
  },

  async openai({ key, model, messages, temperature = 0.7 }) {
    const data = await jsonFetch("https://api.openai.com/v1/chat/completions", {
      method:"POST", headers:{"content-type":"application/json",authorization:"Bearer "+key},
      body:JSON.stringify({model,messages,temperature})
    });
    const text = data?.choices?.[0]?.message?.content || "";
    if (!text) throw new Error("OpenAI returned no text");
    return {text,raw:data};
  },

  async anthropic({ key, model, messages, temperature = 0.7 }) {
    const data = await jsonFetch("https://api.anthropic.com/v1/messages", {
      method:"POST", headers:{"content-type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model,max_tokens:2048,temperature,messages:messages.filter(m => m.role !== "system")})
    });
    const text = data?.content?.map(x => x.text || "").join("") || "";
    if (!text) throw new Error("Anthropic returned no text");
    return {text,raw:data};
  },

  async huggingface({ key, model, messages }) {
    const data = await jsonFetch("https://router.huggingface.co/v1/chat/completions", {
      method:"POST", headers:{"content-type":"application/json",authorization:"Bearer "+key},
      body:JSON.stringify({model,messages})
    });
    const text = data?.choices?.[0]?.message?.content || "";
    if (!text) throw new Error("Hugging Face returned no text");
    return {text,raw:data};
  },

  async ollamaStream({ url, model, messages, temperature = 0.7, onToken }) {
    if (typeof onToken !== "function") throw new Error("onToken callback is required");
    return ollamaChatStream({ url, model, messages, temperature, onToken });
  },

  async openaiStream({ key, model, messages, temperature = 0.7, onToken }) {
    if (typeof onToken !== "function") throw new Error("onToken callback is required");
    const text = await openAICompatibleStream(
      "https://api.openai.com/v1/chat/completions",
      { "content-type": "application/json", authorization: "Bearer " + key },
      { model, messages, temperature },
      onToken
    );
    return { text };
  },

  async huggingfaceStream({ key, model, messages, onToken }) {
    if (typeof onToken !== "function") throw new Error("onToken callback is required");
    const text = await openAICompatibleStream(
      "https://router.huggingface.co/v1/chat/completions",
      { "content-type": "application/json", authorization: "Bearer " + key },
      { model, messages },
      onToken
    );
    return { text };
  }
};
