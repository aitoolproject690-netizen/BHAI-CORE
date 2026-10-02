import { getUsage } from "./usage.js";

function normalizeLimit(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

export async function budgetStatus(key, limits = {}, delta = {}) {
  const used = await getUsage(key);
  const maxRequests = normalizeLimit(limits.maxRequests ?? process.env.BHAI_MAX_REQUESTS ?? 0);
  const maxInputChars = normalizeLimit(limits.maxInputChars ?? process.env.BHAI_MAX_INPUT_CHARS ?? 0);
  const addRequests = Math.max(0, Number(delta.requests) || 0);
  const addInputChars = Math.max(0, Number(delta.inputChars) || 0);

  return {
    exceeded: (maxRequests > 0 && used.requests + addRequests > maxRequests) ||
      (maxInputChars > 0 && used.charsIn + addInputChars > maxInputChars),
    used,
    limits: { maxRequests, maxInputChars },
    requested: { requests: addRequests, inputChars: addInputChars }
  };
}

export async function assertBudget(key, limits = {}, delta = {}) {
  const status = await budgetStatus(key, limits, delta);
  if (status.exceeded) {
    const e = new Error("Usage budget exceeded");
    e.code = "BUDGET_EXCEEDED";
    e.details = status;
    throw e;
  }
}

