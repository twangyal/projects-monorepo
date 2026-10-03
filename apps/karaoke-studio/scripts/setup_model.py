"""Explicit, bounded setup of the official checksum-pinned Spleeter model.

The source code is MIT-licensed. A separate license for the checkpoint was not
established; the official release has no LICENSE/NOTICE/model-card member.
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
from karaoke.pipeline import MODEL_FILES, MODEL_SHA256, model_ready  # noqa: E402

MODEL_URL = 'https://github.com/deezer/spleeter/releases/download/v1.4.0/2stems.tar.gz'
CHECKSUM_URL = 'https://github.com/deezer/spleeter/releases/download/v1.4.0/checksum.json'
MODEL_ARCHIVE_BYTES = 73109797


def checksum(path: Path) -> str:
    result = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def setup_model(model_root: Path, archive: Path | None = None) -> Path:
    model_root = model_root.expanduser().resolve()
    model_root.mkdir(parents=True, exist_ok=True)
    destination = model_root / '2stems'
    if destination.exists():
        if model_ready(model_root):
            return destination
        raise RuntimeError('The existing model cache is incomplete or corrupt. Rename/remove that 2stems directory and run explicit setup again.')
    with tempfile.TemporaryDirectory(prefix='.model-setup-', dir=model_root) as temporary:
        staging = Path(temporary)
        if archive is None:
            archive = staging / '2stems.tar.gz'
            with urllib.request.urlopen(MODEL_URL, timeout=30) as response, archive.open('wb') as output:
                downloaded = 0
                while chunk := response.read(1024 * 1024):
                    downloaded += len(chunk)
                    if downloaded > MODEL_ARCHIVE_BYTES:
                        raise RuntimeError('The model download exceeds its pinned official size.')
                    output.write(chunk)
        if archive.stat().st_size != MODEL_ARCHIVE_BYTES or checksum(archive) != MODEL_SHA256:
            raise RuntimeError('The checkpoint archive does not match the official pinned size and SHA256.')
        directory = staging / '2stems'
        directory.mkdir()
        with tarfile.open(archive, 'r:gz') as source:
            for name in MODEL_FILES:
                member = source.getmember(name)
                if not member.isfile() or member.size > 80000000:
                    raise RuntimeError(f'Unexpected model archive component: {name}')
                stream = source.extractfile(member)
                if stream is None:
                    raise RuntimeError(f'Unreadable model archive component: {name}')
                with stream, (directory / name).open('wb') as output:
                    shutil.copyfileobj(stream, output)
        if not model_ready(staging):
            raise RuntimeError('Extracted model components failed their pinned checksums.')
        (directory / '.probe').write_text('OK')
        directory.rename(destination)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', type=Path, required=True, help='Cache parent outside Git; contains 2stems/')
    parser.add_argument('--archive', type=Path, help='Optional existing official archive (verified before extraction)')
    args = parser.parse_args()
    destination = setup_model(args.model_dir, args.archive)
    print(f'Official Spleeter v1.4.0 two-stem model verified at {destination}')
    print(f'Archive SHA256: {MODEL_SHA256}')
    print(f'Provenance: {MODEL_URL}\nPublished checksum: {CHECKSUM_URL}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, tarfile.TarError) as error:
        print(f'Model setup failed: {error}', file=sys.stderr)
        raise SystemExit(1) from error
