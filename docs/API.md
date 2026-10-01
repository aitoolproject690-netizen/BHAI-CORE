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


## Models and capabilities
- `GET /v1/models` — lists configured models and their capability metadata.
- `GET /v1/models?probe=true` — additionally probes configured Ollama and discovers locally installed models from `/api/tags`.
- `GET /v1/models/capabilities?provider=ollama&model=llava:latest` — returns capability metadata for a provider/model pair.
- Ollama model discovery never returns API keys or external provider credentials.


## Vision
- `POST /v1/vision/analyze` — authenticated image understanding endpoint.
- Body: `{ "prompt": "...", "image": { "data": "<base64 or data URL>" }, "provider": "ollama" }`.
- The provider is optional; BHAI selects the first configured vision-capable model.
- Current adapters: Ollama, Gemini, OpenAI, Anthropic.
- Image request body limit is 12 MB; individual image limit defaults to 8 MB.
- Provider credentials are never returned.


## Image generation
- `GET /v1/image/providers` — reports local image provider availability metadata.
- `POST /v1/image/generate` — authenticated image-generation submission.
- Body: `{ "prompt": "...", "provider": "comfyui", "seed": 123 }`.
- Optional `workflow` may provide a ComfyUI API-format workflow.
- The default adapter submits to a local ComfyUI server; BHAI-CORE does not pretend to generate an image when no generation runtime is configured.
- Generation is asynchronous and returns a ComfyUI `prompt_id` with HTTP 202.

## Voice
- `GET /v1/voice/providers` — reports local Whisper STT and Piper TTS configuration.
- `POST /v1/voice/transcribe` — authenticated base64 audio transcription.
- `POST /v1/voice/synthesize` — authenticated text-to-speech generation.
- The default architecture is local/self-hosted; endpoints return 503 until the corresponding runtime is explicitly enabled.
- Audio and TTS text limits are configurable with `BHAI_MAX_AUDIO_BYTES` and `BHAI_MAX_TTS_CHARS`.

## Unified Agent
- `GET /v1/agent/tools` — lists the safe, authenticated BHAI tool registry.
- `POST /v1/agent/execute` — executes one registered tool for the authenticated app key.
- Available tools include chat, owner-scoped RAG search/context, vision, local image generation, local voice STT/TTS, model discovery, and persistent jobs.
- Tool metadata never exposes provider credentials.
- The first agent layer is deterministic tool execution; higher-level planning can be added without changing the tool contracts.

## Agent Planner
- `POST /v1/agent/plan` — creates a deterministic plan from a request or validates an explicitly selected tool.
- `POST /v1/agent/run` — executes a validated plan sequentially and returns per-step status.
- Plans are limited by `BHAI_AGENT_MAX_STEPS` (default 8).
- Failed steps stop subsequent execution; results include completed steps and the failure message.

## Conversations / Memory

- `GET /v1/memory/info` — memory limits and storage information.
- `POST /v1/conversations` — create an owner-scoped conversation.
- `GET /v1/conversations` — list the authenticated owner's conversations.
- `GET /v1/conversations/:id` — read a conversation.
- `POST /v1/conversations/:id/messages` — append a user/assistant/tool/system message.
- `GET /v1/conversations/:id/context` — return bounded context for the Agent.
- `DELETE /v1/conversations/:id` — delete an owner-scoped conversation.

Memory is persisted in the existing JSON store, isolated by API-key identity, bounded by message/context limits, and redacts common API-key patterns before storage.


## Agent Safety / Permissions
- `GET /v1/agent/policies` — authenticated tool risk/permission metadata.
- Agent execution checks the centralized policy before running a tool.
- API keys may carry explicit `scopes` when created by the admin endpoint, for example `["agent:read","models:read"]`.
- Legacy keys without stored scopes remain compatible with the existing core-agent permission set.
- Permission failures use `PERMISSION_DENIED` and HTTP 403 when surfaced through an HTTP endpoint.
- Future privileged tools such as GitHub writes, deployments, environment/secrets, and destructive operations should receive dedicated scopes rather than inheriting broad agent permissions.
