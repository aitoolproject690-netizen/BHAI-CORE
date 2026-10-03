const base = process.env.ENGINE_URL || "http://127.0.0.1:10000";
const key = process.env.BHAI_ENGINE_API_KEY || "";
const headers = { "content-type": "application/json" };
if (key) headers.authorization = "Bearer " + key;

const health = await fetch(base + "/health");
if (!health.ok) throw new Error("health failed: " + health.status);

const response = await fetch(base + "/v1/chat/completions", {
  method: "POST",
  headers,
  body: JSON.stringify({
    model: process.env.BHAI_ENGINE_MODEL || "smollm2-135m-instruct-q4_k_m",
    messages: [{ role: "user", content: "Reply with exactly: BHAI-ENGINE-OK" }],
    max_tokens: 16,
    temperature: 0
  })
});
if (!response.ok) throw new Error("chat failed: " + response.status);
const data = await response.json();
const text = data?.choices?.[0]?.message?.content || "";
if (!text) throw new Error("empty model response");
console.log("BHAI ENGINE SMOKE OK:", text.trim());
