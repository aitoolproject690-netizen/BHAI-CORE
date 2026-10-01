import { getUsage } from "./usage.js";

export async function budgetStatus(key, limits = {}) {
  const used = await getUsage(key);
  const maxRequests = Number(limits.maxRequests ?? process.env.BHAI_MAX_REQUESTS ?? 0);
  const maxInputChars = Number(limits.maxInputChars ?? process.env.BHAI_MAX_INPUT_CHARS ?? 0);

  return {
    exceeded: (maxRequests > 0 && used.requests >= maxRequests) ||
      (maxInputChars > 0 && used.charsIn >= maxInputChars),
    used,
    limits: { maxRequests, maxInputChars }
  };
}

export async function assertBudget(key, limits = {}) {
  const status = await budgetStatus(key, limits);
  if (status.exceeded) {
    const e = new Error("Usage budget exceeded");
    e.code = "BUDGET_EXCEEDED";
    e.details = status;
    throw e;
  }
}
