export function hasApiAccess({
  masterAuthEnabled,
  masterAuthenticated = false,
  sessionAuthenticated = false,
  apiAuthenticated = false,
  coreApiAuthenticated = false,
  coreApiConfigured = false
} = {}) {
  if (masterAuthEnabled) {
    return Boolean(masterAuthenticated || sessionAuthenticated || apiAuthenticated || coreApiAuthenticated);
  }
  if (coreApiConfigured) return Boolean(coreApiAuthenticated || apiAuthenticated);
  return true;
}
