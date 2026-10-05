const DEFAULT_WINDOW_MS = 60000;
const DEFAULT_MAX_REQUESTS = 120;
const DEFAULT_MAX_BUCKETS = 10000;

function positiveInteger(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function rateLimitInfo() {
  return {
    enabled: process.env.BHAI_RATE_LIMIT_ENABLED !== "false",
    windowMs: positiveInteger(process.env.BHAI_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
    maxRequests: positiveInteger(process.env.BHAI_RATE_LIMIT_MAX, DEFAULT_MAX_REQUESTS),
    maxBuckets: positiveInteger(process.env.BHAI_RATE_LIMIT_MAX_BUCKETS, DEFAULT_MAX_BUCKETS)
  };
}

const buckets = new Map();

function evictExpired(now, windowMs) {
  for (const [key, bucket] of buckets) {
    if (now - bucket.startedAt >= windowMs) buckets.delete(key);
  }
}

export function checkRateLimit(key, options = {}) {
  const cfg = rateLimitInfo();
  if (options?.bypass) return { allowed: true, remaining: cfg.maxRequests, bypassed: true };
  if (!cfg.enabled) return { allowed: true };

  const now = Date.now();
  const k = String(key || "anonymous");
  let bucket = buckets.get(k);

  if (!bucket || now - bucket.startedAt >= cfg.windowMs) {
    if (!bucket && buckets.size >= cfg.maxBuckets) evictExpired(now, cfg.windowMs);
    if (!bucket && buckets.size >= cfg.maxBuckets) {
      return {
        allowed: false,
        retryAfterMs: cfg.windowMs,
        code: "RATE_LIMIT_CAPACITY"
      };
    }
    bucket = { startedAt: now, count: 0 };
  }

  bucket.count++;
  buckets.set(k, bucket);

  if (bucket.count > cfg.maxRequests) {
    return {
      allowed: false,
      retryAfterMs: Math.max(1, cfg.windowMs - (now - bucket.startedAt))
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, cfg.maxRequests - bucket.count)
  };
}

export function resetRateLimits() {
  buckets.clear();
}
