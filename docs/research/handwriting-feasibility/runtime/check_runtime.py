"""Dependency/import check only: no model loading, fixture reads or inference."""
import importlib.metadata
import json
import resource
import time
resource.setrlimit(resource.RLIMIT_AS, (3 * 1024**3, 3 * 1024**3))
resource.setrlimit(resource.RLIMIT_CPU, (30, 35))
started = time.monotonic()
import torch
from transformers import TrOCRProcessor, VisionEncoderDecoderModel
import safetensors
assert TrOCRProcessor is not None and VisionEncoderDecoderModel is not None and safetensors is not None
torch.set_num_threads(1)
torch.set_num_interop_threads(1)
print(json.dumps({
    'operation': 'dependency-import-only',
    'weightsLoaded': False,
    'inferenceRun': False,
    'versions': {name: importlib.metadata.version(name) for name in ('torch', 'transformers', 'safetensors', 'numpy', 'Pillow', 'sentencepiece')},
    'torchThreads': torch.get_num_threads(),
    'torchInteropThreads': torch.get_num_interop_threads(),
    'cudaAvailable': torch.cuda.is_available(),
    'elapsedSeconds': time.monotonic() - started,
    'peakRssKiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
}, sort_keys=True))
