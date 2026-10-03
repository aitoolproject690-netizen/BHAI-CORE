# Android local inference node

BHAI-CORE can use a local `llama-server` running on an Android/Termux device as its `engine` provider.

## Architecture

```
BHAI-X -> BHAI-CORE -> secure tunnel -> Android/Termux -> llama-server -> GGUF model
```

Keep `llama-server` bound to `127.0.0.1`; do not expose port 8080 directly to the Internet.

## 1. Start llama-server on the phone

For the SmolLM2 node:

```bash
llama-server -m ~/models/smollm2.gguf -ngl 99 --host 127.0.0.1 --port 8080 --no-jinja --api-key YOUR_RANDOM_ENGINE_KEY
```

The current BHAI-CORE engine adapter sends `Authorization: Bearer <key>`, which matches llama-server API-key authentication.

## 2. Verify locally

In a second Termux session (do not stop the server session):

```bash
curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Authorization: Bearer YOUR_RANDOM_ENGINE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"smollm2.gguf","messages":[{"role":"user","content":"Hello bhai"}],"max_tokens":16,"temperature":0}'
```

## 3. Connect the phone to BHAI-CORE

Use a persistent authenticated Cloudflare Tunnel for production. The tunnel should map a stable hostname to:

```
http://127.0.0.1:8080
```

Quick Tunnels (`trycloudflare.com`) are suitable only for testing because the hostname changes when the process stops. They also do not support SSE.

After the tunnel is available, configure BHAI-CORE:

- `BHAI_ENGINE_URL=https://YOUR-STABLE-HOSTNAME`
- `BHAI_ENGINE_MODEL=smollm2.gguf`
- `BHAI_ENGINE_API_KEY=YOUR_RANDOM_ENGINE_KEY`
- keep `engine` first in `AI_PROVIDER_ORDER`

Never commit the engine key or tunnel token.

## 4. Connection test

From a machine that can reach BHAI-CORE's configured engine URL:

```bash
curl https://YOUR-STABLE-HOSTNAME/v1/chat/completions \
  -H "Authorization: Bearer YOUR_RANDOM_ENGINE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"smollm2.gguf","messages":[{"role":"user","content":"Hello bhai"}],"max_tokens":16,"temperature":0}'
```

A valid JSON `choices[0].message.content` confirms the phone node is reachable.

## Security notes

- Do not run the tunnel without llama-server API authentication.
- Do not bind llama-server to `0.0.0.0` unless an authenticated reverse proxy is intentionally in front of it.
- Treat the tunnel token and engine API key as production secrets.
- Quick Tunnels are for development/testing, not a permanent BHAI-X production node.
