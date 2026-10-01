import { config } from "./config.js";
import { providerAdapters } from "./providers.js";
import { breakerState, canAttempt, recordFailure, recordSuccess } from "./circuitBreaker.js";
import { withRetry, classifyError } from "./retry.js";

function isConfigured(name, cfg) {
  return Boolean(cfg.providers[name]?.key && providerAdapters[name]);
}

export function getProviderStatus() {
  const cfg = config();
  return Object.fromEntries(
    Object.keys(providerAdapters).map(name => [
      name,
      {
        configured: isConfigured(name, cfg),
        model: cfg.providers[name].model,
        enabled: cfg.providerOrder.includes(name),
        breaker: breakerState(name)
      }
    ])
  );
}

export async function generate({ messages, provider, temperature = 0.7, maxAttempts } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages must be a non-empty array");
  }

  const cfg = config();
  const requested = provider ? [String(provider).toLowerCase()] : cfg.providerOrder;
  const candidates = requested.filter(name => isConfigured(name, cfg));

  if (!candidates.length) throw new Error("No AI provider is configured");

  const attempts = Math.min(maxAttempts || candidates.length, candidates.length);
  const errors = [];

  for (let i = 0; i < attempts; i++) {
    const name = candidates[i];
    if (!canAttempt(name)) {
      errors.push({ provider: name, kind: "circuit_open", error: "Circuit breaker is open" });
      continue;
    }

    try {
      const result = await withRetry(
        () => providerAdapters[name]({ ...cfg.providers[name], messages, temperature }),
        { retries: Number(process.env.BHAI_PROVIDER_RETRIES ?? 2) }
      );
      recordSuccess(name);
      return {
        ok: true,
        provider: name,
        model: cfg.providers[name].model,
        text: result.text,
        attempts: i + 1
      };
    } catch (error) {
      recordFailure(name);
      errors.push({
        provider: name,
        kind: classifyError(error),
        error: error?.message || String(error)
      });
    }
  }

  const error = new Error("All configured AI providers failed");
  error.details = errors;
  throw error;
}
