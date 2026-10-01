const usage = new Map();

function bucket(key) {
  if (!usage.has(key)) usage.set(key, { requests: 0, failures: 0, charsIn: 0, charsOut: 0 });
  return usage.get(key);
}

export function recordUsage({ key = "anonymous", input = 0, output = 0, failed = false }) {
  const b = bucket(key);
  b.requests += 1;
  b.charsIn += input;
  b.charsOut += output;
  if (failed) b.failures += 1;
  return { ...b };
}

export function getUsage(key = "anonymous") {
  return { ...bucket(key) };
}

export function allUsage() {
  return Object.fromEntries([...usage.entries()].map(([k,v]) => [k, { ...v }]));
}

export function resetUsage() {
  usage.clear();
}
