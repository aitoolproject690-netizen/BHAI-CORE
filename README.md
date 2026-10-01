# BHAI-CORE

Independent AI foundation for the BHAI ecosystem.

## What is here
- Stable chat API
- Provider adapters
- Automatic provider fallback
- Centralized configuration
- Health/provider status
- No lock-in to Render, Replit, or one AI provider

## Endpoints
GET /health
GET /v1/providers
POST /v1/chat/completions

Example:
{
  "messages": [{"role":"user","content":"Hello bhai"}]
}

## Roadmap
1. Core gateway + routing
2. Provider health and circuit breaker
3. Streaming
4. Usage metering and budgets
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
