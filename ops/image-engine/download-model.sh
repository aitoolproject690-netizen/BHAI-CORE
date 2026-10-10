#!/bin/sh
set -eu

MODEL_DIR="/opt/ComfyUI/models/checkpoints"
MODEL_NAME="flux1-schnell-fp8.safetensors"
MODEL_SHA256="ead426278b49030e9da5df862994f25ce94ab2ee4df38b556ddddb3db093bf72"
MODEL_URL="https://huggingface.co/Comfy-Org/flux1-schnell/resolve/main/flux1-schnell-fp8.safetensors"
DEST="${MODEL_DIR}/${MODEL_NAME}"
TEMP="${DEST}.partial"

mkdir -p "$MODEL_DIR"
if [ -f "$DEST" ] && printf '%s  %s\n' "$MODEL_SHA256" "$DEST" | sha256sum -c - >/dev/null 2>&1; then
  echo "FLUX Schnell model already exists and checksum is valid."
  exit 0
fi

rm -f "$TEMP"
echo "Downloading the 17.2 GB FLUX.1-schnell FP8 checkpoint..."
curl --fail --location --retry 5 --retry-delay 3 --connect-timeout 30 "$MODEL_URL" --output "$TEMP"
printf '%s  %s\n' "$MODEL_SHA256" "$TEMP" | sha256sum -c -
mv "$TEMP" "$DEST"
echo "FLUX Schnell checkpoint installed and checksum verified."
