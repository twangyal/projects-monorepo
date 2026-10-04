# Handwriting82 dependency gate only

No model checkpoint was downloaded or loaded. No fixture inference, personalization training or held-out prediction ran. The current enforced network policy rejects the official HuggingFace model-card host; the original Azure checkpoint host is also outside the allowed policy. Do not retry through a mirror, custom proxy or direct route.

Private dependency setup already executed before the instruction to stop installing large unused runtime:

```sh
UV_CACHE_DIR=/workspace/handwriting82-feasibility/runtime/uv-cache uv venv --python /opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python /workspace/handwriting82-feasibility/runtime/env
UV_CACHE_DIR=/workspace/handwriting82-feasibility/runtime/uv-cache uv pip install --python /workspace/handwriting82-feasibility/runtime/env/bin/python --index-url https://download.pytorch.org/whl/cpu torch==2.6.0+cpu
UV_CACHE_DIR=/workspace/handwriting82-feasibility/runtime/uv-cache uv pip install --python /workspace/handwriting82-feasibility/runtime/env/bin/python --index-url https://pypi.org/simple transformers==4.57.3 safetensors==0.6.2 pillow==11.3.0 numpy==2.2.6 sentencepiece==0.2.1
```

Exact resolved dependencies are in requirements-resolved.txt. Dependency/import check only, isolated and offline:

```sh
timeout 45s env HF_HOME=/tmp/handwriting82-hf TORCH_HOME=/tmp/handwriting82-torch HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 BLIS_NUM_THREADS=1 MALLOC_ARENA_MAX=2 /workspace/handwriting82-feasibility/runtime/env/bin/python -I /workspace/handwriting82-feasibility/runtime/check_runtime.py
```

The script imposes CPU30/35 seconds and address-space3GiB before importing libraries. It does not create/load a model or read images. Result:6.837833236990264seconds,356464KiB peakRSS, CUDA unavailable, Torch intra/inter-op threads1. These are import measurements, not inference measurements.
