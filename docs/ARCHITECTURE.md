# BHAI-CORE Architecture

BHAI-CORE is the provider-neutral AI foundation for BHAI applications.

## Layers

1. API gateway — stable HTTP contract.
2. Router — chooses configured providers in declared order.
3. Provider adapters — isolate provider-specific request/response formats.
4. Reliability — fallback and circuit breakers prevent one provider failure from taking down the gateway.
5. Configuration — credentials stay in environment variables.
6. Future layers — auth, metering, streaming, files/RAG, vision, voice, jobs and BHAI-CLOUD.

BHAI applications should depend on the BHAI-CORE API contract, not on a specific AI vendor.

## Reliability rule

A provider failure is isolated. The router can continue with another configured provider. Repeated failures open a temporary circuit; a later request can probe the provider again after cooldown.

## Security rule

Never store API keys in Git. Production credentials belong in environment variables or a secrets manager.
