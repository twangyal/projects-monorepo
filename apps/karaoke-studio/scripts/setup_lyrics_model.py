"""Explicit, bounded setup of the checksum-pinned lyric recognition models.

- NVIDIA Parakeet TDT 0.6B v2 (English), int8 ONNX export published by the sherpa-onnx project.
  Model license: CC-BY-4.0 (NVIDIA). sherpa-onnx: Apache-2.0.
- Silero VAD (MIT), the copy published by the sherpa-onnx project.

Files land in ``MODEL_DIR/lyrics-asr``; the studio never downloads models at startup.
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
from karaoke.transcription import ASR_ARCHIVE, ASR_DIRECTORY, ASR_FILES, ASR_RELEASE, asr_ready  # noqa: E402

ARCHIVE_BYTES = 482468385
ARCHIVE_SHA256 = '157c157bc51155e03e37d2466522a3a737dd9c72bb25f36eb18912964161e1ad'
VAD_NAME = 'silero_vad.onnx'
VAD_BYTES = 643854
ARCHIVE_PREFIX = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/'


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


def setup(model_root: Path, archive: Path | None = None, vad: Path | None = None) -> Path:
    model_root = model_root.expanduser().resolve()
    model_root.mkdir(parents=True, exist_ok=True)
    destination = model_root / ASR_DIRECTORY
    if destination.exists():
        if asr_ready(model_root):
            return destination
        raise RuntimeError(f'The existing {ASR_DIRECTORY} directory is incomplete or corrupt. Rename or remove it and run setup again.')
    with tempfile.TemporaryDirectory(prefix='.lyrics-setup-', dir=model_root) as temporary:
        staging = Path(temporary)
        if archive is None:
            archive = staging / ASR_ARCHIVE
            download(ASR_RELEASE + ASR_ARCHIVE, archive, ARCHIVE_BYTES)
        if vad is None:
            vad = staging / 'vad.onnx'
            download(ASR_RELEASE + VAD_NAME, vad, VAD_BYTES)
        if archive.stat().st_size != ARCHIVE_BYTES or checksum(archive) != ARCHIVE_SHA256:
            raise RuntimeError('The recognition model archive does not match its pinned size and SHA256.')
        if vad.stat().st_size != VAD_BYTES or checksum(vad) != ASR_FILES[VAD_NAME]:
            raise RuntimeError('The voice-activity model does not match its pinned size and SHA256.')
        directory = staging / ASR_DIRECTORY
        directory.mkdir()
        with tarfile.open(archive, 'r:bz2') as source:
            for name in ASR_FILES:
                if name == VAD_NAME:
                    continue
                member = source.getmember(ARCHIVE_PREFIX + name)
                if not member.isfile() or member.size > 800_000_000:
                    raise RuntimeError(f'Unexpected model archive component: {name}')
                stream = source.extractfile(member)
                if stream is None:
                    raise RuntimeError(f'Unreadable model archive component: {name}')
                with stream, (directory / name).open('wb') as output:
                    shutil.copyfileobj(stream, output)
        shutil.copyfile(vad, directory / VAD_NAME)
        if not asr_ready(staging):
            raise RuntimeError('Extracted recognition model files failed their pinned checksums.')
        directory.rename(destination)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--model-dir', type=Path, required=True, help='The same model directory passed to the studio')
    parser.add_argument('--archive', type=Path, help='Optional existing official archive (verified before extraction)')
    parser.add_argument('--vad', type=Path, help='Optional existing silero_vad.onnx (verified before use)')
    args = parser.parse_args()
    destination = setup(args.model_dir, args.archive, args.vad)
    print(f'Lyric recognition models verified at {destination}')
    print(f'Archive SHA256: {ARCHIVE_SHA256}\nProvenance: {ASR_RELEASE}{ASR_ARCHIVE} and {ASR_RELEASE}{VAD_NAME}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, tarfile.TarError, KeyError) as error:
        print(f'Lyric model setup failed: {error}', file=sys.stderr)
        raise SystemExit(1) from error
