"""Explicit, bounded setup of the checksum-pinned vocal separation model.

UVR-MDX-NET-Voc_FT, a vocal model from the Ultimate Vocal Remover project (models published at
https://github.com/TRvlvr/model_repo; the UVR application is MIT-licensed), in the ONNX conversion
published by sherpa-onnx (Apache-2.0). A separate license for the weights was not established from
those publications. Weights are not bundled in this repository.

The file lands in ``MODEL_DIR/mdx``; the studio never downloads models at startup.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import shutil
import sys
import tempfile
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from karaoke.pipeline import MODEL_BYTES, MODEL_DIRECTORY, MODEL_FILE, MODEL_SHA256, MODEL_URL, model_ready  # noqa: E402


def checksum(path: Path) -> str:
    result = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def setup_model(model_root: Path, model: Path | None = None) -> Path:
    model_root = model_root.expanduser().resolve()
    model_root.mkdir(parents=True, exist_ok=True)
    destination = model_root / MODEL_DIRECTORY
    if destination.exists():
        if model_ready(model_root):
            return destination
        raise RuntimeError(f'The existing {MODEL_DIRECTORY} directory is incomplete or corrupt. Rename or remove it and run setup again.')
    with tempfile.TemporaryDirectory(prefix='.model-setup-', dir=model_root) as temporary:
        staging = Path(temporary)
        directory = staging / MODEL_DIRECTORY
        directory.mkdir()
        target = directory / MODEL_FILE
        if model is None:
            with urllib.request.urlopen(MODEL_URL, timeout=30) as response, target.open('wb') as output:
                downloaded = 0
                while chunk := response.read(1024 * 1024):
                    downloaded += len(chunk)
                    if downloaded > MODEL_BYTES:
                        raise RuntimeError('The model download exceeds its pinned size.')
                    output.write(chunk)
        else:
            if model.stat().st_size != MODEL_BYTES:
                raise RuntimeError('The model file does not match its pinned size.')
            shutil.copyfile(model, target)
        if target.stat().st_size != MODEL_BYTES or checksum(target) != MODEL_SHA256:
            raise RuntimeError('The model file does not match its pinned size and SHA256.')
        if not model_ready(staging):
            raise RuntimeError('The model failed its pinned checksum.')
        directory.rename(destination)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--model-dir', type=Path, required=True, help=f'Cache parent outside Git; receives {MODEL_DIRECTORY}/')
    parser.add_argument('--model', type=Path, help=f'Optional existing copy of {MODEL_FILE} (verified before use)')
    args = parser.parse_args()
    destination = setup_model(args.model_dir, args.model)
    print(f'Vocal separation model verified at {destination}')
    print(f'SHA256: {MODEL_SHA256}\nProvenance: {MODEL_URL}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError) as error:
        print(f'Model setup failed: {error}', file=sys.stderr)
        raise SystemExit(1) from error
