# BHAI Mobile IPv6 Gateway

This gateway is the phone-side HTTP(S) edge for a local OpenAI-compatible `llama-server`.

## Safety model

- Binds to IPv6 (`::`) by default; the local engine stays on `127.0.0.1:18080`.
- Requires a dedicated bearer token (or a token file) before forwarding any `/v1/*` request.
- Only exposes `/v1/models`, `/v1/chat/completions`, and `/v1/chat/completions/stream`.
- Replaces the incoming `Authorization` header with the local engine key, so the engine key is never forwarded from the public side.
- Enforces body/response limits, request timeout, per-client rate limiting, and bounded concurrency.
- TLS is supported through `BHAI_MOBILE_GATEWAY_TLS=true` plus certificate/key files.

## Termux

Use `ops/mobile-gateway-start.sh` after creating the gateway token file. Do not expose the llama-server port directly.

For a public Internet deployment, use TLS. Plain HTTP is suitable only for a controlled connectivity test because bearer credentials and prompts are otherwise sent without transport encryption.

## BHAI-CORE target

BHAI-CORE already accepts a normal OpenAI-compatible engine URL. Point it at the phone gateway with an IPv6 literal, for example:

```text
BHAI_ENGINE_URL=http://[2401:db8::1234]:19180
BHAI_ENGINE_MODEL=smollm2.gguf
BHAI_ENGINE_API_KEY=<the gateway token>
```

Use HTTPS and the appropriate CA trust configuration for production.
