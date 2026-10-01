const states = new Map();

export function breakerState(provider) {
  return states.get(provider) || { failures: 0, openedAt: 0, state: "closed" };
}

export function canAttempt(provider, cooldownMs = 30000) {
  const s = breakerState(provider);
  if (s.state !== "open") return true;
  if (Date.now() - s.openedAt >= cooldownMs) {
    states.set(provider, { ...s, state: "half-open" });
    return true;
  }
  return false;
}

export function recordSuccess(provider) {
  states.set(provider, { failures: 0, openedAt: 0, state: "closed" });
}

export function recordFailure(provider, threshold = 3) {
  const s = breakerState(provider);
  const failures = s.failures + 1;
  states.set(provider, {
    failures,
    openedAt: failures >= threshold ? Date.now() : s.openedAt,
    state: failures >= threshold ? "open" : "closed"
  });
}

export function resetBreakers() {
  states.clear();
}
