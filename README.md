# BHAI-CORE

Independent AI foundation for the BHAI ecosystem.

## What is here
- Stable authenticated chat API
- Provider adapters
- Automatic provider fallback
- Centralized configuration
- Health/provider status and telemetry
- Usage metering, budgets and streaming
- Owner-scoped cloud/domain infrastructure
- No lock-in to Render, Replit, or one AI provider

## Endpoints

Core:
- GET /health
- GET /v1/providers
- GET /v1/usage
- GET /v1/metrics
- POST /v1/chat/completions
- POST /v1/chat/completions/stream
- GET /v1/keys (admin)
- POST /v1/keys (admin)
- POST /v1/keys/:id/rotate (admin)
- DELETE /v1/keys/:id (admin)
- GET /v1/keys/:id/usage (admin)
- GET /v1/usage (admin)
- GET /v1/metrics (admin)
- GET /v1/audit (admin)

Cloud/infrastructure routes are available under /v1/cloud/* for builds, deployments, services, domains, DNS, certificates, network, auto-deploy and TLS status. Mutation routes are authenticated and the cloud mutation surface requires the cloud:build permission. High-risk agent/cloud mutations additionally use the approval flow.

## Authentication

Chat completions require a valid BHAI API key in the x-bhai-key header.

Example request:

POST /v1/chat/completions
x-bhai-key: bhai_...
content-type: application/json

{
  "messages": [{"role":"user","content":"Hello bhai"}]
}

API keys are stored as hashes and are shown only at creation/rotation time. Admins can list, revoke, rotate and inspect per-key usage. Optional per-key limits include maxRequests and maxInputChars; a request is rejected before the provider is called when it would cross either limit. Usage telemetry identifies BHAI keys by a non-reversible hash-derived identifier; raw keys are not persisted in usage records. Provider error telemetry is also redacted before persistence.

Admin-only operational endpoints use the x-bhai-admin-key header and are separate from normal user-key authentication.

## Security model

- API keys are hashed at rest and scopes are enforced per agent tool.
- Default API-key permissions do not grant GitHub write/admin or cloud-build mutation access.
- High-risk GitHub and cloud mutations require the matching permission plus an approved, input-bound approval record.
- Jobs, workspaces, services, deployments, domains, DNS records and audit records are owner-scoped.
- Cloud execution paths are constrained to the authenticated owner's workspace/deployment roots and reject path/symlink escapes.
- GitHub repository and file paths are validated to prevent traversal.
- GitHub webhooks require BHAI_GITHUB_WEBHOOK_SECRET and a valid HMAC SHA-256 signature; delivery IDs are deduplicated.
- HTTP requests are rate-limited and request bodies have a hard size limit.
- Audit records are bounded and redact common API-key/secret prefixes.
- Health checks are restricted to local service targets to avoid arbitrary SSRF.
- Dangerous shell patterns are rejected by build/runtime command validation.
- Never commit real API keys or other production secrets.

## Quick API examples

Create an API key from the authenticated dashboard or admin API:

```bash
curl -X POST https://bhai-core.onrender.com/v1/keys \
  -H 'x-bhai-admin-key: YOUR_ADMIN_KEY' \
  -H 'content-type: application/json' \
  -d '{"name":"my-app","limits":{"maxRequests":1000,"maxInputChars":100000}}'
```

Chat:

```bash
curl -X POST https://bhai-core.onrender.com/v1/chat/completions \
  -H 'x-bhai-key: bhai_...' \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Hello bhai"}]}'
```

Rotate a key:

```bash
curl -X POST https://bhai-core.onrender.com/v1/keys/KEY_ID/rotate \
  -H 'x-bhai-admin-key: YOUR_ADMIN_KEY'
```

## Provider routing

The router uses the configured AI_PROVIDER_ORDER and skips providers that are not configured. Provider failures can trigger retries and circuit-breaker protection before the router falls back to another configured provider.

## Streaming

Streaming uses provider-neutral SSE events: start, token, complete, and error. Streaming requests use the same BHAI key authentication, projected per-key budget controls, billing quota and provider circuit protection.

## Persistent storage

The store is backend-pluggable. The default is JSON at data/bhai-core-store.json, which is suitable for local/single-host use. For durable production storage, set BHAI_STORE_BACKEND=postgres and provide DATABASE_URL.

The PostgreSQL backend stores the complete state document in JSONB, uses a transaction plus row lock for updates, enforces the same store size limit, and keeps the HTTP/API contract unchanged. BHAI_STORE_PG_TABLE defaults to bhai_core_store. PostgreSQL is optional: leaving BHAI_STORE_BACKEND unset keeps the existing JSON behavior.

Production deployments should use a durable PostgreSQL instance rather than relying on an ephemeral application filesystem.

## Custom domains and HTTPS

BHAI-CORE supports optional local HTTPS termination so a future BHAI-CLOUD ingress layer does not depend on Render's TLS handling. Set BHAI_TLS_ENABLED=true and provide a certificate/key pair with BHAI_TLS_CERT_FILE and BHAI_TLS_KEY_FILE. HTTPS listens on BHAI_TLS_PORT (default 8443). Certificate issuance/renewal is intentionally external for now; the core only terminates and validates configured certificates. Use GET /v1/cloud/tls/info to inspect non-secret TLS configuration.

The domain/route layer remains owner-scoped. Public DNS and ACME certificate automation are separate infrastructure concerns and are not silently assumed to exist.

## Certificate lifecycle

BHAI-CORE has a persistent owner-scoped certificate lifecycle for custom domains, including ACME challenge metadata, renewal state, and certificate status APIs. Actual ACME issuance/renewal remains disabled by default and must be explicitly configured.

## Development

Run npm test for the test suite and npm run check for syntax checks.

## Production checklist

Before exposing BHAI-CORE publicly:
1. Set strong, unique production secrets for API/admin/webhook authentication.
2. Keep BHAI_RUNTIME_ENABLED and other execution features disabled unless required.
3. Grant cloud/GitHub mutation scopes only to keys that need them.
4. Configure a durable store location and back it up.
5. Configure TLS at the deployment/ingress layer.
6. Verify provider quotas, budgets and fallback order.
7. Run npm test and npm run check in CI.
8. Confirm webhook secrets, API keys and private certificate keys are never logged or committed.


## Media, dashboard, and billing APIs

- GET /v1/image/providers lists configured image providers.
- POST /v1/image/generate submits an image generation request; GET /v1/image/jobs/:promptId reads ComfyUI job history.
- GET /v1/video/providers lists the external video adapter.
- POST /v1/video/plan validates and returns a deterministic video timeline.
- POST /v1/video/generate submits the timeline to VIDEO_API_URL when configured.
- GET /v1/billing/plans lists plan quotas.
- GET /v1/billing and GET /v1/billing/usage expose the authenticated owner's billing state.
- POST /v1/billing/admin/subscription changes a customer's plan and requires the admin key.
- GET /v1/dashboard returns an owner-scoped account/resource/billing summary.

Video generation intentionally uses an external adapter rather than embedding a vendor-specific paid API in the core. Configure VIDEO_API_URL and optionally VIDEO_API_KEY when a video provider is selected.



CI verification note: PostgreSQL store integration coverage runs against PostgreSQL 16 in GitHub Actions.

CI trigger verification: 2026-10-03
