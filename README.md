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
GET /health
GET /v1/providers
GET /v1/usage
GET /v1/metrics
POST /v1/chat/completions

## Authentication

Chat completions require a valid BHAI API key in the x-bhai-key header.

Example request:

POST /v1/chat/completions
x-bhai-key: bhai_...
content-type: application/json

{
  "messages": [{"role":"user","content":"Hello bhai"}]
}

API keys are stored as hashes. Usage telemetry identifies BHAI keys by a non-reversible hash-derived identifier; raw keys are not persisted in usage records. Provider error telemetry is also redacted before persistence.

## Provider routing

The router uses the configured AI_PROVIDER_ORDER and skips providers that are not configured. Provider failures can trigger retries and circuit-breaker protection before the router falls back to another configured provider.

## Streaming

Streaming uses provider-neutral SSE events: start, token, complete, and error. Streaming requests use the same BHAI key authentication and budget controls.

## Persistent storage

The default persistent store is JSON at data/bhai-core-store.json. Set BHAI_STORE_FILE to another path. Storage access is isolated behind one store API, so a future SQLite/PostgreSQL backend can replace the JSON backend without changing the HTTP/API contract.

## Custom domains and HTTPS

BHAI-CORE supports optional local HTTPS termination so a future BHAI-CLOUD ingress layer does not depend on Render's TLS handling. Set BHAI_TLS_ENABLED=true and provide a certificate/key pair with BHAI_TLS_CERT_FILE and BHAI_TLS_KEY_FILE. HTTPS listens on BHAI_TLS_PORT (default 8443). Certificate issuance/renewal is intentionally external for now; the core only terminates and validates configured certificates. Use GET /v1/cloud/tls/info to inspect non-secret TLS configuration.

The domain/route layer remains owner-scoped. Public DNS and ACME certificate automation are separate infrastructure concerns and are not silently assumed to exist.

## Certificate lifecycle

BHAI-CORE has a persistent owner-scoped certificate lifecycle for custom domains, including ACME challenge metadata, renewal state, and certificate status APIs. Actual ACME issuance/renewal remains disabled by default and must be explicitly configured.

## Development

Run npm test for the test suite and npm run check for syntax checks.

Never commit real API keys.
