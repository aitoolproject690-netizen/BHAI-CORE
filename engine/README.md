# BHAI Engine Runtime

Minimal self-hosted BHAI inference runtime using llama.cpp through node-llama-cpp.

Default bootstrap model: QuantFactory/SmolLM2-135M-Instruct-GGUF, Q4_K_M. The model is Apache-2.0 and the quantized Q4_K_M artifact is about 105 MB.

## Runtime

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`
- Optional Bearer auth via `BHAI_ENGINE_API_KEY`
- Streaming uses OpenAI-compatible SSE `data:` chunks.

## Render deployment

Create a Node web service from this repository with:

Build:
`cd engine && npm install && npx node-llama-cpp pull --dir ./models hf:QuantFactory/SmolLM2-135M-Instruct-GGUF:Q4_K_M`

Start:
`node engine/server.js`

Environment:
- `BHAI_ENGINE_MODEL=smollm2-135m-instruct-q4_k_m`
- `BHAI_ENGINE_API_KEY=<secret>`

The BHAI-CORE control plane can then point `BHAI_ENGINE_URL` at this service and use the same secret as `BHAI_ENGINE_API_KEY`.

This is a bootstrap model, not the final coding model. Upgrade the model later without changing the BHAI-CORE API contract.
