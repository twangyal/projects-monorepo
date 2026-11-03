"""Explicit, bounded setup of the checksum-pinned lyric recognition models.

- NVIDIA Parakeet TDT 0.6B v2 (English), installed to ``MODEL_DIR/lyrics-asr``, and v3 (English and
  24 other European languages), installed to ``MODEL_DIR/lyrics-asr-v3``: int8 ONNX exports published
  by the sherpa-onnx project. Model license: CC-BY-4.0 (NVIDIA). sherpa-onnx: Apache-2.0.
- SenseVoice Small (Chinese, Cantonese, Japanese, Korean and English), int8, installed to
  ``MODEL_DIR/lyrics-asr-sensevoice``. Model license: the FunASR model license (FunAudioLLM).
- Silero VAD (MIT), the copy published by the sherpa-onnx project, alongside each.
- The lyric aligner: Meta's wav2vec 2.0 base fine-tuned on 960 h of LibriSpeech (Apache-2.0), as the int8 ONNX export
  published for transformers.js, installed to ``MODEL_DIR/lyrics-aligner``. It places supplied lyrics on the singing.

All are installed by default; the studio then chooses a recognizer for each song from its first words.
``--only`` installs one (``--only aligner`` the aligner). The studio never downloads models at startup.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from karaoke.alignment import ALIGNER, ALIGNER_SOURCE, aligner_ready  # noqa: E402
from karaoke.transcription import ASR_MODELS, ASR_RELEASE, VAD_FILE, AsrModel, archive_model, model_ready  # noqa: E402

VAD_BYTES = 643854


def checksum(path: Path) -> str:
    result = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def download(url: str, destination: Path, limit: int) -> None:
    with urllib.request.urlopen(url, timeout=30) as response, destination.open('wb') as output:
        received = 0
        while chunk := response.read(1024 * 1024):
            received += len(chunk)
            if received > limit:
                raise RuntimeError(f'{destination.name} exceeds its pinned size.')
            output.write(chunk)


def setup(model_root: Path, model: AsrModel, archive: Path | None = None, vad: Path | None = None) -> Path:
    model_root = model_root.expanduser().resolve()
    model_root.mkdir(parents=True, exist_ok=True)
    destination = model_root / model.directory
    if destination.exists():
        if model_ready(model_root, model):
            return destination
        raise RuntimeError(f'The existing {model.directory} directory is incomplete or corrupt. Rename or remove it and run setup again.')
    prefix = model.archive.removesuffix('.tar.bz2') + '/'
    with tempfile.TemporaryDirectory(prefix='.lyrics-setup-', dir=model_root) as temporary:
        staging = Path(temporary)
        if archive is None:
            archive = staging / model.archive
            download(ASR_RELEASE + model.archive, archive, model.archive_bytes)
        if vad is None:
            vad = staging / 'vad.onnx'
            download(ASR_RELEASE + VAD_FILE, vad, VAD_BYTES)
        if archive.stat().st_size != model.archive_bytes or checksum(archive) != model.archive_sha256:
            raise RuntimeError(f'The {model.key} recognition model archive does not match its pinned size and SHA256.')
        if vad.stat().st_size != VAD_BYTES or checksum(vad) != model.files[VAD_FILE]:
            raise RuntimeError('The voice-activity model does not match its pinned size and SHA256.')
        directory = staging / model.directory
        directory.mkdir()
        with tarfile.open(archive, 'r:bz2') as source:
            for name in model.files:
                if name == VAD_FILE:
                    continue
                member = source.getmember(prefix + name)
                if not member.isfile() or member.size > 800_000_000:
                    raise RuntimeError(f'Unexpected model archive component: {name}')
                stream = source.extractfile(member)
                if stream is None:
                    raise RuntimeError(f'Unreadable model archive component: {name}')
                with stream, (directory / name).open('wb') as output:
                    shutil.copyfileobj(stream, output)
        shutil.copyfile(vad, directory / VAD_FILE)
        if not model_ready(staging, model):
            raise RuntimeError('Extracted recognition model files failed their pinned checksums.')
        directory.rename(destination)
    return destination


def setup_aligner(model_root: Path) -> Path:
    """Download the aligner's pinned files into ``MODEL_DIR/lyrics-aligner`` and verify them."""
    model_root = model_root.expanduser().resolve()
    model_root.mkdir(parents=True, exist_ok=True)
    destination = model_root / ALIGNER.directory
    if destination.exists():
        if aligner_ready(model_root):
            return destination
        raise RuntimeError(f'The existing {ALIGNER.directory} directory is incomplete or corrupt. Rename or remove it and run setup again.')
    with tempfile.TemporaryDirectory(prefix='.aligner-setup-', dir=model_root) as temporary:
        staging = Path(temporary)
        directory = staging / ALIGNER.directory
        directory.mkdir()
        for published, (name, size, sha256) in ALIGNER.files.items():
            download(ALIGNER_SOURCE + published, directory / name, size)
            if (directory / name).stat().st_size != size or checksum(directory / name) != sha256:
                raise RuntimeError(f'The lyric aligner file {name} does not match its pinned size and SHA256.')
        if not aligner_ready(staging):
            raise RuntimeError('The lyric aligner files failed their pinned checksums.')
        directory.rename(destination)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--model-dir', type=Path, required=True, help='The same model directory passed to the studio')
    parser.add_argument('--only', choices=[*(model.key for model in ASR_MODELS), 'aligner'], help='Install one model instead of all')
    parser.add_argument('--archive', type=Path, action='append', default=[],
                        help='Optional existing official archive, repeatable (matched by size, verified before extraction)')
    parser.add_argument('--vad', type=Path, help='Optional existing silero_vad.onnx (verified before use)')
    args = parser.parse_args()
    archives = {}
    for path in args.archive:
        model = archive_model(path)
        if model is None:
            raise RuntimeError(f'{path} is not the pinned size of any recognition model archive.')
        archives[model.key] = path
    for model in ASR_MODELS:
        if args.only and model.key != args.only:
            continue
        destination = setup(args.model_dir, model, archives.get(model.key), args.vad)
        print(f'{model.key.capitalize()} lyric recognition model verified at {destination}')
        print(f'Archive SHA256: {model.archive_sha256}\nProvenance: {ASR_RELEASE}{model.archive} and {ASR_RELEASE}{VAD_FILE}')
    if not args.only or args.only == 'aligner':
        destination = setup_aligner(args.model_dir)
        print(f'Lyric aligner verified at {destination}\nProvenance: {ALIGNER_SOURCE} ({", ".join(ALIGNER.files)})')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, tarfile.TarError, KeyError) as error:
        print(f'Lyric model setup failed: {error}', file=sys.stderr)
        raise SystemExit(1) from error
