import { getProviderStatus } from "./router.js";
import { mobileNodeInfo } from "./mobileNode.js";
import { selfHostedImageWorkerStatus } from "./imageWorker.js";

export function health() {
  return {
    ok: true,
    service: "BHAI-CORE",
    version: "0.1.0",
    mobileNode: mobileNodeInfo(),
    selfHostedImageWorker: selfHostedImageWorkerStatus()
  };
}

export function readiness() {
  const providers = getProviderStatus();
  const configured = Object.values(providers).some(p => p.configured);
  return {
    ready: configured,
    providers
  };
}
