import { config } from "./config.js";
import { providerAdapters } from "./providers.js";
import { breakerState, canAttempt, recordFailure, recordSuccess } from "./circuitBreaker.js";
import { withRetry, classifyError } from "./retry.js";
import { recordProviderUsage } from "./usage.js";

export function isProviderConfigured(name, cfg = config()) {
  return Boolean(cfg.providers[name]?.key && typeof providerAdapters[name] === "function");
}

export function normalizeMaxAttempts(value, fallback) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return fallback;
  return Math.min(number, fallback);
}

export function getProviderStatus() {
  const cfg = config();
  return Object.fromEntries(
    Object.keys(providerAdapters)
      .filter(name => !name.endsWith("Stream"))
      .map(name => [
        name,
        {
          configured: isProviderConfigured(name, cfg),
          model: String(cfg.providers[name]?.model ?? ""),
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
  const candidates = requested.filter(name => isProviderConfigured(name, cfg));

  if (!candidates.length) throw new Error("No AI provider is configured");

  const attempts = normalizeMaxAttempts(maxAttempts, candidates.length);
  const errors = [];

  for (let i = 0; i < attempts; i++) {
    const name = candidates[i];
    if (!canAttempt(name)) {
      errors.push({ provider: name, kind: "circuit_open", error: "Circuit breaker is open" });
      continue;
    }

    const startedAt = Date.now();
    let retries = 0;

    try {
      const result = await withRetry(
        () => providerAdapters[name]({ ...cfg.providers[name], messages, temperature }),
        {
          retries: Number(process.env.BHAI_PROVIDER_RETRIES ?? 2),
          onRetry: () => { retries += 1; }
        }
      );
      const latencyMs = Date.now() - startedAt;
      recordSuccess(name);
      await recordProviderUsage({ provider: name, success: true, latencyMs, retries });
      return {
        ok: true,
        provider: name,
        model: cfg.providers[name].model,
        text: result.text,
        attempts: i + 1,
        retries,
        latency_ms: latencyMs
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      recordFailure(name);
      await recordProviderUsage({ provider: name, success: false, latencyMs, retries, error });
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
