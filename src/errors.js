export function publicError(error) {
  return {
    error: error?.message || "Unknown error",
    details: Array.isArray(error?.details) ? error.details : undefined
  };
}
