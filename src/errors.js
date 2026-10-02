function redactSecrets(value) {
  let text = String(value ?? "");
  text = text.replace(/(bearer\s+)[^\s,;]+/gi, "$1[redacted]");
  text = text.replace(/(x-bhai-key\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]");
  text = text.replace(/(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]");
  text = text.replace(/([?&]key\s*=\s*)[^&\s,;]+/gi, "$1[redacted]");
  text = text.replace(/\bbhai_[A-Za-z0-9_-]+\b/g, "bhai_[redacted]");
  return text;
}

function sanitizeDetails(details) {
  if (!Array.isArray(details)) return undefined;
  return details.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return redactSecrets(item);
    return {
      provider: item.provider == null ? undefined : String(item.provider),
      kind: item.kind == null ? undefined : String(item.kind),
      error: item.error == null ? undefined : redactSecrets(item.error)
    };
  });
}

export function publicError(error) {
  return {
    error: redactSecrets(error?.message || "Unknown error"),
    details: sanitizeDetails(error?.details)
  };
}
