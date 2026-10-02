const RETRYABLE_CODES = new Set([
  "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN",
  "429", "500", "502", "503", "504",
  "RATE_LIMITED", "TIMEOUT", "TEMPORARY"
]);

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function normalizeRetries(value, fallback = 2) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.max(0, number);
}

function positiveFinite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function classifyError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();

  if (status === 401 || status === 403 || /invalid.*(key|api)|unauthorized|forbidden/.test(message)) {
    return "auth";
  }
  if (status === 404 || /model.*not.*found|not found/.test(message)) {
    return "model";
  }
  if (status === 429 || RETRYABLE_CODES.has(code) || /rate.?limit|timeout|temporar|overloaded|capacity/.test(message)) {
    return "retryable";
  }
  if (status >= 500 && status <= 599) return "retryable";
  return "permanent";
}

export function backoffMs(attempt, baseMs = 250, maxMs = 4000) {
  const base = positiveFinite(baseMs, 250);
  const max = Math.max(base, positiveFinite(maxMs, 4000));
  const safeAttempt = nonNegativeInteger(attempt, 1);
  const exp = Math.min(max, base * (2 ** Math.max(0, safeAttempt - 1)));
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exp * 0.25)));
  return Math.min(max, exp + jitter);
}

export async function withRetry(fn, options = {}) {
  const retries = normalizeRetries(options.retries ?? 2, 2);
  const baseMs = positiveFinite(options.baseMs ?? 250, 250);
  const maxMs = Math.max(baseMs, positiveFinite(options.maxMs ?? 4000, 4000));
  const onRetry = typeof options.onRetry === "function" ? options.onRetry : null;

  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt + 1);
    } catch (error) {
      const kind = classifyError(error);
      if (kind !== "retryable" || attempt >= retries) throw error;
      attempt += 1;
      onRetry?.({ attempt, error });
      await new Promise(resolve => setTimeout(resolve, backoffMs(attempt, baseMs, maxMs)));
    }
  }
}
