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
