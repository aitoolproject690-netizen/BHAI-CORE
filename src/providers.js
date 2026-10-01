function timeoutSignal(ms = 30000) {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}
async function jsonFetch(url, options, timeoutMs = 30000) {
  const response = await fetch(url, { ...options, signal: timeoutSignal(timeoutMs) });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(data?.error?.message || data?.error || data?.message || data?.raw || "HTTP " + response.status);
  return data;
}
export const providerAdapters = {
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
      method:"POST", headers:{"content-type":"application/json",authorization:"Bearer "+key}, body:JSON.stringify({model,messages,temperature})
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
  }
};
