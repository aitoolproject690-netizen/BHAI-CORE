#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$HOME/bhai-mobile"
LLAMA_DIR="$ROOT/llama.cpp"
MODEL_DIR="$HOME/models"

echo "== BHAI Mobile Engine installer =="

pkg update -y
pkg install -y git cmake ninja clang make pkg-config curl nodejs python
pkg install -y vulkan-loader-android vulkan-headers shaderc vulkan-tools 2>/dev/null || true

mkdir -p "$ROOT" "$MODEL_DIR"

if ! command -v llama-server >/dev/null 2>&1; then
  if [ ! -d "$LLAMA_DIR/.git" ]; then
    git clone --depth=1 https://github.com/ggerganov/llama.cpp.git "$LLAMA_DIR"
  fi

  rm -rf "$LLAMA_DIR/build-mobile"
  cmake -S "$LLAMA_DIR" -B "$LLAMA_DIR/build-mobile" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DGGML_VULKAN=ON \
    -DGGML_OPENMP=ON \
    -DBUILD_SHARED_LIBS=OFF \
    -DLLAMA_CURL=ON

  cmake --build "$LLAMA_DIR/build-mobile" --target llama-server llama-cli -j 4

  mkdir -p "$PREFIX/bin"
  cp "$LLAMA_DIR/build-mobile/bin/llama-server" "$PREFIX/bin/llama-server"
  cp "$LLAMA_DIR/build-mobile/bin/llama-cli" "$PREFIX/bin/llama-cli"
  chmod +x "$PREFIX/bin/llama-server" "$PREFIX/bin/llama-cli"
fi

echo "== Vulkan device check =="
if command -v vulkaninfo >/dev/null 2>&1; then
  vulkaninfo --summary 2>&1 | head -80 || true
fi

echo "== llama.cpp devices =="
if command -v llama-cli >/dev/null 2>&1; then
  llama-cli --list-devices 2>&1 || true
fi

MODEL="$MODEL_DIR/SmolLM2-135M-Instruct.Q4_K_M.gguf"
if [ ! -s "$MODEL" ]; then
  curl -L --fail --retry 3 \
    "https://huggingface.co/QuantFactory/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct.Q4_K_M.gguf" \
    -o "$MODEL"
fi

mkdir -p "$ROOT/node"
cp "$(dirname "$0")/bhai-mobile-node.mjs" "$ROOT/node/bhai-mobile-node.mjs"
cp "$(dirname "$0")/run-engine.sh" "$ROOT/run-engine.sh"
cp "$(dirname "$0")/start-node.sh" "$ROOT/start-node.sh"
cp "$(dirname "$0")/.env.example" "$ROOT/.env.example"
chmod +x "$ROOT/run-engine.sh" "$ROOT/start-node.sh"

echo "Installer complete."
echo "Model: $MODEL"
echo "Next: cp ~/bhai-mobile/.env.example ~/bhai-mobile/.env and set BHAI_MOBILE_API_KEY."
