# BHAI Mobile Engine (Android / Termux)

This directory turns a compatible Android phone into a local BHAI inference node.

Target: OnePlus 12R / Snapdragon 8 Gen 2 / Adreno 740 / Android 16.

Architecture:
BHAI-X -> BHAI-CORE -> secure tunnel or local network -> BHAI Mobile Node :8090 -> llama-server :8080 -> GGUF model -> Adreno GPU when the runtime reports a usable backend.

The mobile node keeps the same OpenAI-compatible /v1/chat/completions contract used by BHAI-CORE.

Runtime policy:
- GPU-first when the detected backend is usable.
- CPU fallback when GPU initialization fails.
- Small GGUF model for the first smoke test.
- API-key authentication at the mobile-node boundary.
- Localhost binding by default.

Phone setup:
  cd ~
  git clone https://github.com/aitoolproject690-netizen/BHAI-CORE.git
  cd BHAI-CORE/mobile/termux
  bash install.sh

Then:
  cp .env.example ~/bhai-mobile/.env
  nano ~/bhai-mobile/.env
  bash ~/bhai-mobile/run-engine.sh

In another Termux session:
  bash ~/bhai-mobile/start-node.sh

The first model is the existing BHAI bootstrap model:
QuantFactory/SmolLM2-135M-Instruct-GGUF:Q4_K_M

The mobile node exposes:
- GET /health
- GET /ready
- GET /v1/models
- POST /v1/chat/completions

The node listens on 127.0.0.1:8090 by default.

Do not expose the node directly to the public internet. Remote BHAI-CORE access should use a secure tunnel and a private API key.

GPU verification must come from llama-cli --list-devices or the llama-server startup log. The setup must never claim GPU acceleration just because -ngl is set.
