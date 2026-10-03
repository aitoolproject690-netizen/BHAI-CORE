#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$HOME/bhai-mobile"

if [ -f "$ROOT/.env" ]; then
  set -a
  . "$ROOT/.env"
  set +a
fi

MODEL="\${BHAI_MODEL_PATH:-$HOME/models/SmolLM2-135M-Instruct.Q4_K_M.gguf}"
LLAMA_PORT="\${LLAMA_SERVER_PORT:-8080}"
LLAMA_HOST="\${LLAMA_SERVER_HOST:-127.0.0.1}"
GPU_LAYERS="\${BHAI_GPU_LAYERS:-99}"
CONTEXT="\${BHAI_CONTEXT:-2048}"
THREADS="\${BHAI_THREADS:-6}"

[ -s "$MODEL" ] || { echo "Model not found: $MODEL"; exit 1; }

termux-wake-lock 2>/dev/null || true
export ASAN_OPTIONS="\${ASAN_OPTIONS:-detect_leaks=0}"

if command -v llama-cli >/dev/null 2>&1; then
  echo "== llama devices =="
  llama-cli --list-devices 2>&1 || true
fi

if [ -f "$PREFIX/share/vulkan/icd.d/freedreno_icd.aarch64.json" ]; then
  export VK_ICD_FILENAMES="$PREFIX/share/vulkan/icd.d/freedreno_icd.aarch64.json"
  echo "Using Freedreno/Turnip Vulkan ICD."
fi

echo "Starting llama-server on $LLAMA_HOST:$LLAMA_PORT with GPU layers=$GPU_LAYERS"
exec llama-server \
  -m "$MODEL" \
  --host "$LLAMA_HOST" \
  --port "$LLAMA_PORT" \
  -ngl "$GPU_LAYERS" \
  -c "$CONTEXT" \
  -t "$THREADS" \
  --no-warmup
