export function selfHostedImageWorkerStatus(_mobile = null, _env = process.env) {
  // The legacy Local Dream worker is intentionally disabled because its output
  // quality does not meet BHAI-X production requirements. Do not advertise it
  // as ready even if an old mobile node still reports it as loaded.
  return {
    ok: false,
    service: "BHAI self-hosted image worker",
    configured: false,
    ready: false,
    connected: false,
    provider: "mobile-local-dream",
    engine: null,
    reason: "quality_policy_disabled",
    replacement: "self-hosted-comfyui-gpu"
  };
}
