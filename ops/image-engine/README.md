# BHAI Self-Hosted GPU Image Engine

This optional service runs ComfyUI on **your own NVIDIA GPU host** and is called by BHAI-CORE over the private Docker network. It does not call a hosted image-generation API and does not use the phone's text-generation process. The phone's llama.cpp / SmolLM2 service is untouched.

## Hardware and disk

- Use an NVIDIA GPU host with NVIDIA Container Toolkit installed. A practical starting target for the bundled FLUX.1-schnell FP8 checkpoint is a 24 GB VRAM GPU; 48 GB provides more headroom. Actual VRAM use varies by GPU, runtime and dimensions, so confirm with a real generation on the chosen machine.
- Allow at least 30 GB free persistent disk for the 17.2 GB checkpoint, container layers, cache and generated outputs.
- Install Docker Engine and the Docker Compose plugin. Configure the NVIDIA Container Toolkit using the official [NVIDIA installation guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).

## Start the private ComfyUI service

From the BHAI-CORE repository on the GPU host, start the Core stack once first. This creates the private `bhai-public` Docker network:

```bash
docker compose -f docker-compose.selfhost.yml up -d --build
```

Build and start the image service:

```bash
docker compose -f docker-compose.image.yml up -d --build
```

Download the model into the named Docker volume. This is a large download; it is intentionally **not** part of container startup or CI:

```bash
docker compose -f docker-compose.image.yml exec image-engine /usr/local/bin/download-flux-model
```

The installer downloads `Comfy-Org/flux1-schnell/flux1-schnell-fp8.safetensors` and validates its SHA-256 checksum before activating it. The checkpoint is 17.2 GB. Its published model-card license is Apache-2.0; see the [official Comfy-Org model card](https://huggingface.co/Comfy-Org/flux1-schnell). Keep the model in the persistent `bhai-image-models` volume.

Restart ComfyUI once after the checkpoint download so the model inventory is refreshed:

```bash
docker compose -f docker-compose.image.yml restart image-engine
```

## Connect Core to the image service

Add these lines to the root `.env` file on the same host (do not commit real credentials):

```dotenv
COMFYUI_URL=http://image-engine:8188
BHAI_IMAGE_WORKFLOW=flux-schnell
COMFYUI_CHECKPOINT=flux1-schnell-fp8.safetensors
BHAI_IMAGE_STEPS=4
```

Recreate only the Core container so it receives the new settings:

```bash
docker compose -f docker-compose.selfhost.yml up -d --force-recreate bhai-core
```

The image service has no published host port. Its HTTP API is available only to containers on the private `bhai-public` network; route public calls through authenticated BHAI-CORE APIs.

## Verify

```bash
docker compose -f docker-compose.image.yml ps
docker compose -f docker-compose.image.yml logs --tail=80 image-engine
docker compose -f docker-compose.image.yml exec image-engine curl --fail --silent http://127.0.0.1:8188/system_stats
```

First verify the actual model/GPU readiness. This endpoint returns HTTP 200 only when the Core can reach ComfyUI, sees the configured checkpoint, and sees an NVIDIA/CUDA device; otherwise it returns HTTP 503 with a specific reason. Run from inside the Core container:

```bash
docker compose -f docker-compose.selfhost.yml exec -T bhai-core node -e 'fetch("http://127.0.0.1:10000/v1/image/health",{headers:{"x-bhai-key":process.env.BHAI_CORE_BOOTSTRAP_API_KEY}}).then(async r=>{console.log("HTTP",r.status,await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})'
```

Only after readiness is green, call the authenticated Core endpoint `POST /v1/image/generate` with `{"prompt":"cinematic 3D Indian village at golden hour","provider":"comfyui","aspectRatio":"16:9"}`. It returns a job ID; poll `GET /v1/image/jobs/{jobId}` for ComfyUI history. BHAI-X's `BHAI_IMAGE_URL` should point to Core's private `/v1/internal/image/generate` route, with `BHAI_IMAGE_API_KEY` matching Core's `BHAI_CORE_INTERNAL_IMAGE_KEY` in the same private Docker network.

## Important limits

- This is a self-hosted inference runtime, not model training. Stable identity across recurring characters (such as Aarav and Meera) needs reference-image / adapter workflows such as IP-Adapter or a trained LoRA; the base text-to-image preset alone does not promise character consistency.
- FLUX.1-schnell is a good general-purpose base, not a guarantee of perfect hands, exact text, or identical faces on every seed. Test outputs before calling image generation production-ready.
- The current preset creates one image using a fixed server-owned graph. Client-submitted arbitrary ComfyUI graphs are deliberately ignored, to prevent callers from invoking unapproved nodes or accessing server resources.
- Core CI validates Compose configuration and the installer syntax; the expensive model download and GPU inference smoke test must run on the real GPU host.
