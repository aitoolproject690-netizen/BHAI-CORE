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

## Self-hosted deployment (no Render dependency)

BHAI-CORE includes a single-host Docker deployment bundle. The same process can expose the public Core API and the built-in `/v1/mobile-node` WebSocket relay, so a user-owned VPS can replace the Render Core + separate relay pair.

Build and run on your own Linux host:

```bash
cp ops/self-host.env.example .env
# Edit .env and set strong private values.
docker compose -f docker-compose.selfhost.yml up -d --build
```

The container keeps the JSON store on the named `bhai-core-data` volume. For this phone-engine layout, set `BHAI_ENGINE_URL=mobile://local` and point the Mobile Node at the host's BHAI-CORE URL. The API and node tokens must be unique strong secrets and must never be committed.

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

CI verification branch check: 2026-10-03
Production hardening verification: standardized provider error HTTP mapping merged and CI-verified on 2026-10-03


## BHAI engine (self-hosted model contract)

BHAI-CORE can use a self-hosted, vendor-neutral BHAI engine before external providers. Configure:
- `BHAI_ENGINE_URL`: base URL of an OpenAI-compatible inference server (the adapter accepts either `/v1` or a host root).
- `BHAI_ENGINE_MODEL`: model identifier exposed by that server (default `bhai-local`).
- `BHAI_ENGINE_API_KEY`: optional engine credential; it is never returned by provider status.

The default provider order is now `engine,ollama,gemini,openai,anthropic,huggingface`. The engine is only considered configured when both its URL and model are present, so existing deployments keep working until a real self-hosted engine is connected.

This separates the BHAI API/control plane from the model runtime. A future BHAI inference service can therefore replace Gemini without changing the public chat API or BHAI X integration. Ollama remains available as a local development bridge while the self-hosted model runtime is being built.

## Audit verification

Dashboard authentication, API-key access, and Render client-identity handling were re-verified on 2026-10-05.

## Public self-host gateway

For a user-owned Linux/VPS host, Caddy can terminate public HTTPS and route one domain: `/v1/*` plus Core health/dashboard routes go to BHAI-CORE, while the BHAI-X web app stays on the same origin. Caddy also proxies WebSocket upgrades for the mobile-node connection.

Start the Core stack first so the shared `bhai-public` Docker network exists, then run `docker compose -f docker-compose.public.yml up -d`. Point the chosen DNS name at the host and set `BHAI_DOMAIN` in the gateway environment. Caddy obtains and renews public certificates automatically for qualifying DNS names.


## BHAI Garage lifecycle tooling

A user-owned Linux host can bootstrap the full BHAI Garage from this repository without a managed hosting provider. The installer clones the current BHAI-CORE and BHAI-X repositories, generates fresh Core/admin/database secrets, keeps them in host-local files with mode 600, starts the Core and BHAI-X stacks, and puts Caddy in front as the only public entrypoint.

```bash
export BHAI_DOMAIN=ai.example.com
bash ops/install-garage.sh
```

The installer asks only for the existing Mobile Node token and writes generated credentials to /opt/bhai-garage/credentials.txt (or the selected GARAGE_ROOT). It never commits those secrets.

For later updates:

```bash
bash ops/update-garage.sh
```

Before upgrades or migrations, create a backup:

```bash
bash ops/backup-garage.sh
```

Restore from a backup archive:

```bash
bash ops/restore-garage.sh /opt/bhai-garage/backups/YYYYMMDDTHHMMSSZ.tar.gz
```

The self-hosted Core and BHAI-X services do not publish port 10000 directly on the host. Caddy is the public edge and routes Core API/WebSocket traffic and the BHAI-X web app through the same HTTPS origin. BHAI-X uses the internal Docker address http://bhai-core:10000 by default, so its control-plane connection does not depend on a public Core URL.

## Phone-side IPv6 engine gateway

BHAI-CORE includes an authenticated phone-side gateway for a local OpenAI-compatible engine. It listens on IPv6 while keeping `llama-server` bound to loopback only.

The gateway exposes only `/v1/models`, `/v1/chat/completions`, and `/v1/chat/completions/stream`; public authentication and the local engine credential are separate. Request/response limits, timeout, per-client rate limiting, and bounded concurrency are enforced.

For Termux, use `ops/mobile-gateway-start.sh`. Keep the gateway token in `~/.config/bhai/mobile-gateway-key` and the local engine key in `~/.config/bhai/engine-key`. Never publish port 18080 directly.

The gateway supports TLS through certificate/key files. Plain HTTP is only for controlled connectivity testing because credentials and prompts would otherwise cross the network unencrypted.

BHAI-CORE can target the gateway with an IPv6 literal such as `http://[YOUR_IPV6]:19180` for testing or the equivalent HTTPS URL for production. The current Render relay remains independent until the direct IPv6 path is proven end-to-end.

