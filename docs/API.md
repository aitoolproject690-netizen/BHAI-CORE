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
