export async function probeLocalImageEngine({
  url,
  apiKey = "",
  fetchImpl = globalThis.fetch,
  timeoutMs = 3000
} = {}) {
  const endpoint = String(url || "").trim().replace(/\/+$/, "");
  if (!endpoint || typeof fetchImpl !== "function") return false;

  const controller = new AbortController();
  const duration = Number(timeoutMs) > 0 ? Number(timeoutMs) : 3000;
  const timer = setTimeout(() => controller.abort(), duration);
  const headers = { "content-type": "application/json" };
  const key = String(apiKey || "");
  if (key) headers.authorization = "Bearer " + key;

  try {
    const response = await fetchImpl(endpoint + "/tokenize", {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: "bhai image probe" }),
      signal: controller.signal
    });
    return Number(response?.status) >= 200 && Number(response?.status) < 300;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
