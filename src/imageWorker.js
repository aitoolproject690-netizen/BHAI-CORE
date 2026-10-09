import { mobileNodeInfo } from "./mobileNode.js";

export function selfHostedImageWorkerStatus(mobile = mobileNodeInfo(), env = process.env) {
  const configured = Boolean(String(env.BHAI_IMAGE_WORKER_KEY || "").trim());
  const engines = Array.isArray(mobile?.engines) ? mobile.engines : [];
  const engine = engines.find(item => String(item?.id || "").toLowerCase() === "local-image") || null;
  const connected = Boolean(mobile?.connected);
  const engineReady = Boolean(engine?.ready && engine?.loaded &&
    Array.isArray(engine?.capabilities) && engine.capabilities.includes("image-text-to-image"));
  const ready = configured && connected && engineReady;
  const reason = !configured ? "worker_key_not_configured" :
    !connected ? "mobile_node_disconnected" :
    !engine ? "local_dream_not_registered" :
    !engineReady ? "local_dream_probe_failed" : null;
  return {
    ok: ready, service: "BHAI self-hosted image worker", configured, ready, connected,
    provider: "mobile-local-dream",
    engine: engine ? { id: String(engine.id), name: String(engine.name || "Local Dream"),
      model: engine.model || null, backend: engine.backend || null,
      ready: Boolean(engine.ready), loaded: Boolean(engine.loaded),
      capabilities: Array.isArray(engine.capabilities) ? engine.capabilities : [] } : null,
    reason
  };
}
