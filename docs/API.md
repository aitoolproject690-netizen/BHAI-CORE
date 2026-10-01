# BHAI-CORE API Contract

## Health

- `GET /health` — process is alive.
- `GET /ready` — at least one AI provider is configured.

## Providers

- `GET /v1/providers` — provider configuration/status.

## Chat

- `POST /v1/chat/completions`
- Body:
  - `messages`: non-empty array
  - `provider`: optional provider name
  - `temperature`: optional
  - `max_attempts`: optional fallback limit

The response identifies the provider and model used.

## Authentication

- Optional global gateway key: `Authorization: Bearer <BHAI_CORE_API_KEY>`
- App key: `x-bhai-key: <generated-key>`
- Admin key management: `x-bhai-admin-key: <BHAI_CORE_ADMIN_KEY>`

Provider credentials are never returned by the API.


## Jobs (foundation)
The internal job protocol uses:
- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`

A persistent queue/worker implementation will use this contract without changing the public API.


## Jobs
- `POST /v1/jobs` — enqueue an authenticated job; returns HTTP 202.
- `GET /v1/jobs/:id` — retrieve an authenticated job and its current status.


## Streaming chat
`POST /v1/chat/completions/stream` returns Server-Sent Events and requires `x-bhai-key`.

Event sequence:
- `start`
- zero or more `token`
- `complete` or `error`

Currently streaming adapters are available for OpenAI and Hugging Face's OpenAI-compatible router. Streaming requests use budget checks and provider telemetry, with bounded retries before any token is emitted. Partial-output failures are not retried to avoid duplicated text. Streaming requests use the same budget checks and provider telemetry as normal chat, plus circuit-breaker protection and bounded retries for failures that happen before any token is emitted. If partial output has already been sent, the request is not retried to avoid duplicated text.


## Metrics
- `GET /v1/usage` — usage totals grouped by app/API key.
- `GET /v1/metrics` — provider telemetry: requests, successes, failures, retries, cumulative/last latency, last status and last error.

Provider pricing is intentionally not hard-coded; future billing can attach a configurable price catalog without changing provider routing.


## Files
- `GET /v1/files` — list files owned by the authenticated BHAI key.
- `POST /v1/files` — create a text file from `name`, `text`, and optional `mimeType`.
- `GET /v1/files/:id` — retrieve an owned file and its text.
- `DELETE /v1/files/:id` — delete an owned file.
- `GET /v1/files/search?q=...` — owner-scoped text search with snippets.
- `GET /v1/files/limits` — current file/text limits.

The current search is deterministic text matching. The storage contract is designed so chunking and vector/embedding search can be added later without changing file ownership or API-key boundaries.


## RAG
- `GET /v1/rag/search?q=...` — owner-scoped ranked chunk search.
- `GET /v1/rag/context?q=...` — returns ranked source chunks plus assembled context for an AI prompt.
- Files are automatically chunked and indexed when created.
- Deleting a file removes its RAG index.
- Current ranking is deterministic keyword scoring; the index can later be replaced with embeddings/vector search.
