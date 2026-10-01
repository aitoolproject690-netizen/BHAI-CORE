import { getProviderStatus } from "./router.js";

export function health() {
  return { ok: true, service: "BHAI-CORE", version: "0.1.0" };
}

export function readiness() {
  const providers = getProviderStatus();
  const configured = Object.values(providers).some(p => p.configured);
  return {
    ready: configured,
    providers
  };
}
