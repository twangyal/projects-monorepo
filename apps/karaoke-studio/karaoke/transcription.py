"""Automatic lyric transcription of separated vocals in a killable offline subprocess.

The parent process imports no ML packages. ``transcribe_vocals`` runs ``transcribe_worker.py`` on a
vocals WAV and returns validated, timed words. Recognition uses NVIDIA's Parakeet TDT 0.6B v2
(int8, English) through sherpa-onnx, with Silero voice-activity detection splitting the vocals into
sung phrases. Models are installed explicitly by ``scripts/setup_lyrics_model.py``; nothing is
downloaded at run time.
"""
from __future__ import annotations

from collections.abc import Callable
import hashlib
import json
import math
from pathlib import Path
import sys
import threading

from .limits import MAX_DURATION, MAX_WORKER_RSS_KIB, WORKER_TIMEOUT
from .pipeline import _run

ASR_DIRECTORY = 'lyrics-asr'
ASR_RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/'
ASR_ARCHIVE = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2'
ASR_FILES = {
    'encoder.int8.onnx': 'a32b12d17bbbc309d0686fbbcc2987b5e9b8333a7da83fa6b089f0a2acd651ab',
    'decoder.int8.onnx': 'b6bb64963457237b900e496ee9994b59294526439fbcc1fecf705b31a15c6b4e',
    'joiner.int8.onnx': '7946164367946e7f9f29a122407c3252b680dbae9a51343eb2488d057c3c43d2',
    'tokens.txt': 'ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d',
    'silero_vad.onnx': '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
}
MODEL_NAME = 'parakeet-tdt-0.6b-v2-int8+silero-vad'
MAX_WORDS = 6000
MAX_TRANSCRIPT_BYTES = 1024 * 1024


_verified: dict[str, tuple] = {}


def asr_ready(model_root: Path) -> bool:
    """All pinned files present with matching SHA-256 (re-hashed only when a file's metadata changes)."""
    directory = Path(model_root) / ASR_DIRECTORY
    try:
        stats = [(directory / name).stat(follow_symlinks=False) for name in ASR_FILES]
        signature = tuple((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) for info in stats)
    except OSError:
        return False
    if _verified.get(str(directory)) == signature:
        return True
    try:
        for name, expected in ASR_FILES.items():
            path = directory / name
            if path.is_symlink() or not path.is_file() or path.stat().st_size > 800_000_000:
                return False
            digest = hashlib.sha256()
            with path.open('rb') as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(chunk)
            if digest.hexdigest() != expected:
                return False
        _verified[str(directory)] = signature
        return True
    except OSError:
        return False


def validate_transcript(value: object, duration: float) -> dict:
    """Strict shape for stored transcripts: model name, timed words and processing time."""
    if not isinstance(value, dict) or set(value) != {'model', 'words', 'seconds'}:
        raise ValueError('The lyric transcript has an unexpected shape.')
    if value['model'] != MODEL_NAME:
        raise ValueError('The lyric transcript came from an unknown model.')
    seconds = value['seconds']
    if type(seconds) not in (int, float) or not math.isfinite(seconds) or seconds < 0:
        raise ValueError('The lyric transcript has invalid processing time.')
    words = value['words']
    if not isinstance(words, list) or len(words) > MAX_WORDS:
        raise ValueError('The lyric transcript has too many words.')
    previous = 0.0
    for word in words:
        if not isinstance(word, dict) or set(word) != {'text', 'start', 'end', 'confidence'}:
            raise ValueError('A transcript word has an unexpected shape.')
        text, start, end, confidence = word['text'], word['start'], word['end'], word['confidence']
        if type(confidence) not in (int, float) or not 0 <= confidence <= 1:
            raise ValueError('A transcript word has an invalid confidence.')
        if (not isinstance(text, str) or not text.strip() or len(text) > 60 or '\x00' in text
                or type(start) not in (int, float) or type(end) not in (int, float)
                or not math.isfinite(start) or not math.isfinite(end)
                or not previous - 1e-6 <= start <= end <= min(duration, MAX_DURATION) + 0.5):
            raise ValueError('A transcript word has invalid text or timing.')
        previous = start
    return dict(model=MODEL_NAME, words=words, seconds=float(seconds))


def transcribe_vocals(vocals: Path, output: Path, model_root: Path, duration: float,
                      cancel: threading.Event, stage: Callable[[str], None]) -> dict:
    """Write ``output`` (a new transcript JSON) and return the validated transcript."""
    if not asr_ready(model_root):
        raise RuntimeError('The verified lyric recognition model is unavailable. Run scripts/setup_lyrics_model.py first.')
    if output.exists() or output.is_symlink():
        raise ValueError('The transcript destination already exists.')
    stage('Recognizing sung lyrics locally from the separated vocals')

    def progress(line: bytes) -> None:
        if cancel.is_set():
            raise RuntimeError('Lyric recognition cancelled.')
        record = json.loads(line)
        if (not isinstance(record, dict) or set(record) != {'type', 'completed', 'total'} or record['type'] != 'progress'
                or type(record['completed']) is not int or type(record['total']) is not int
                or not 0 <= record['completed'] <= record['total'] <= 2000):
            raise ValueError('Invalid recognition progress.')
        stage(f'Recognizing sung lyrics locally — phrase {record["completed"]} of {record["total"]}')

    try:
        _run([sys.executable, str(Path(__file__).with_name('transcribe_worker.py')), '--vocals', str(vocals),
              '--output', str(output), '--model-root', str(Path(model_root).resolve())],
             cancel, timeout=WORKER_TIMEOUT, stderr_limit=256 * 1024, rss_limit_kib=MAX_WORKER_RSS_KIB,
             stdout_line_callback=progress)
        if output.is_symlink() or not output.is_file() or output.stat().st_size > MAX_TRANSCRIPT_BYTES:
            raise RuntimeError('Lyric recognition produced an invalid transcript.')
        try:
            transcript = validate_transcript(json.loads(output.read_bytes()), duration)
        except (ValueError, UnicodeError) as error:
            raise RuntimeError(f'Lyric recognition produced an invalid transcript. {error}') from None
        return transcript
    except BaseException:
        output.unlink(missing_ok=True)
        output.with_suffix('.json.part').unlink(missing_ok=True)
        raise
