# BHAI Mobile IPv6 Gateway

This gateway is the phone-side HTTP(S) edge for a local OpenAI-compatible `llama-server`.

## Safety model

- Binds to IPv6 (`::`) by default; the local engine stays on `127.0.0.1:18080`.
- Requires a dedicated bearer token (or a token file) before forwarding any `/v1/*` request.
- Only exposes `/v1/models` and `/v1/chat/completions`; streaming uses the standard `stream:true` body flag.
- Replaces the incoming `Authorization` header with the local engine key, so the engine key is never forwarded from the public side.
- Enforces body/response limits, request timeout, per-client rate limiting, and bounded concurrency.
- TLS is supported through `BHAI_MOBILE_GATEWAY_TLS=true` plus certificate/key files.
- For a self-hosted phone edge without a domain/CA dependency, the gateway can use a persistent self-signed certificate while BHAI-CORE pins its SHA-256 fingerprint.

## Termux

Use `ops/mobile-gateway-start.sh` for foreground runs, or `ops/mobile-gateway-service.sh start|stop|status|restart` for a persistent background process. Do not expose the llama-server port directly.

For a public Internet deployment, use TLS. Plain HTTP is suitable only for a controlled connectivity test because bearer credentials and prompts are otherwise sent without transport encryption.

For the no-domain phone setup, run `ops/mobile-gateway-tls.sh init` once. The certificate/key stay on the phone. BHAI-CORE uses `BHAI_ENGINE_TLS_FINGERPRINT` to pin that certificate, so hostname/SAN validation is not used for this direct IPv6 path.

## BHAI-CORE target

BHAI-CORE already accepts a normal OpenAI-compatible engine URL. Point it at the phone gateway with an IPv6 literal, for example:

```text
BHAI_ENGINE_URL=http://[2401:db8::1234]:19180
BHAI_ENGINE_MODEL=smollm2.gguf
BHAI_ENGINE_API_KEY=<the gateway token>
```

Use HTTPS. For the pinned self-signed phone gateway, set:
```text
BHAI_ENGINE_URL=https://[YOUR_IPV6]:19180
BHAI_ENGINE_MODEL=smollm2.gguf
BHAI_ENGINE_API_KEY=<the gateway token>
BHAI_ENGINE_TLS_FINGERPRINT=<sha256 fingerprint from the phone>
```
The fingerprint is an identity pin, not a secret.
