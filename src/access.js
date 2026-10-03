export function hasApiAccess({
  masterAuthEnabled,
  masterAuthenticated = false,
  sessionAuthenticated = false,
  apiAuthenticated = false
} = {}) {
  if (!masterAuthEnabled) return true;
  return Boolean(masterAuthenticated || sessionAuthenticated || apiAuthenticated);
}
