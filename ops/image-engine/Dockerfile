FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git libgl1 libglib2.0-0 python3 python3-venv ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
    && /opt/venv/bin/pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu128

RUN git clone --depth 1 https://github.com/Comfy-Org/ComfyUI.git /opt/ComfyUI \
    && /opt/venv/bin/pip install --no-cache-dir -r /opt/ComfyUI/requirements.txt

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin comfy \
    && mkdir -p /opt/ComfyUI/models/checkpoints \
    && chown -R comfy:comfy /opt/ComfyUI

COPY --chown=comfy:comfy ops/image-engine/download-model.sh /usr/local/bin/download-flux-model
RUN chmod 0755 /usr/local/bin/download-flux-model

WORKDIR /opt/ComfyUI
USER comfy
EXPOSE 8188
ENTRYPOINT ["/opt/venv/bin/python", "main.py"]
CMD ["--listen", "0.0.0.0", "--port", "8188", "--disable-auto-launch"]
