# BHAI-CORE

Independent AI foundation for the BHAI ecosystem.

## What is here
- Stable chat API
- Provider adapters
- Automatic provider fallback
- Centralized configuration
- Health/provider status and telemetry
- No lock-in to Render, Replit, or one AI provider

## Endpoints
GET /health
GET /v1/providers
GET /v1/usage
GET /v1/metrics
POST /v1/chat/completions

Example:
{
  "messages": [{"role":"user","content":"Hello bhai"}]
}

## Roadmap
1. Core gateway + routing
2. Provider health and circuit breaker
3. Streaming
4. Usage metering, provider telemetry and budgets
5. Auth/API keys
6. Files/RAG
7. Vision/image/voice adapters
8. Job queue/worker protocol
9. BHAI-CLOUD runtime

Never commit real API keys.


## Reliability
BHAI-CORE now includes provider circuit breakers. Repeated provider failures temporarily open that provider's circuit, while successful requests reset it. The router continues to configured fallback providers when available.

## Development
Run `npm test` for the test suite and `npm run check` for syntax checks.


## Persistent storage
The default persistent store is JSON at `data/bhai-core-store.json`. Set `BHAI_STORE_FILE` to another path. Storage access is isolated behind one store API, so a future SQLite/PostgreSQL backend can replace the JSON backend without changing the HTTP/API contract.

## Streaming
The core includes an SSE utility layer for incremental events. Streaming uses circuit-breaker protection, bounded retries before output starts, request budgets, and provider telemetry.


## Event protocol
Streaming uses provider-neutral events: `start`, `token`, `complete`, and `error`. Job execution uses stable states such as `queued` and `running`, with room for worker-backed states later.


## Custom domains and HTTPS
BHAI-CORE supports optional local HTTPS termination so a future BHAI-CLOUD ingress layer does not depend on Render's TLS handling. Set `BHAI_TLS_ENABLED=true` and provide a certificate/key pair with `BHAI_TLS_CERT_FILE` and `BHAI_TLS_KEY_FILE`. HTTPS listens on `BHAI_TLS_PORT` (default 8443). Certificate issuance/renewal is intentionally external for now; the core only terminates and validates configured certificates. Use `GET /v1/cloud/tls/info` to inspect non-secret TLS configuration.

The domain/route layer remains owner-scoped. Public DNS and ACME certificate automation are separate infrastructure concerns and are not silently assumed to exist.
