"""Automatic lyric transcription of separated vocals in a killable offline subprocess.

The parent process imports no ML packages. ``transcribe_vocals`` runs ``transcribe_worker.py`` on a
vocals WAV and returns validated, timed words. Silero voice-activity detection splits the vocals into
sung phrases, recognized through sherpa-onnx by NVIDIA's Parakeet TDT 0.6B (int8): v2 for English
songs, v3 for the 24 other European languages it covers; and by SenseVoice Small (int8) for
Chinese, Cantonese, Japanese and Korean songs. When installed, Whisper turbo (int8) reads the words
of songs in other languages, timed by Parakeet v3. ``recognize`` in the worker chooses among the
installed models from the song's language. Models are installed explicitly by
``scripts/setup_lyrics_model.py``; nothing is downloaded at run time.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import sys
import threading
import unicodedata

from .limits import MAX_DURATION, MAX_WORKER_RSS_KIB, WORKER_TIMEOUT
from .pipeline import _run

ASR_RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/'
VAD_FILE = 'silero_vad.onnx'
VAD_SHA256 = '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6'


@dataclass(frozen=True)
class AsrModel:
    """One installable recognizer: its stored name, directory and pinned files (Silero VAD included)."""
    key: str
    name: str
    directory: str
    archive: str
    archive_bytes: int
    archive_sha256: str
    files: dict[str, str]


# Parakeet v2 recognizes English singing best (30.9% WER on 20 English songs against v3's 42.3%);
# v3 covers 25 European languages (25.4% German, 44.1% French). Each has its own directory.
ENGLISH = AsrModel(
    'english', 'parakeet-tdt-0.6b-v2-int8+silero-vad', 'lyrics-asr',
    'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2', 482468385,
    '157c157bc51155e03e37d2466522a3a737dd9c72bb25f36eb18912964161e1ad', {
        'encoder.int8.onnx': 'a32b12d17bbbc309d0686fbbcc2987b5e9b8333a7da83fa6b089f0a2acd651ab',
        'decoder.int8.onnx': 'b6bb64963457237b900e496ee9994b59294526439fbcc1fecf705b31a15c6b4e',
        'joiner.int8.onnx': '7946164367946e7f9f29a122407c3252b680dbae9a51343eb2488d057c3c43d2',
        'tokens.txt': 'ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d',
        VAD_FILE: VAD_SHA256,
    })
MULTILINGUAL = AsrModel(
    'multilingual', 'parakeet-tdt-0.6b-v3-int8+silero-vad', 'lyrics-asr-v3',
    'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2', 487170055,
    '5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf', {
        'encoder.int8.onnx': 'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247',
        'decoder.int8.onnx': '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e',
        'joiner.int8.onnx': '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3',
        'tokens.txt': 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d',
        VAD_FILE: VAD_SHA256,
    })
# SenseVoice Small (FunAudioLLM; FunASR model license) hears Chinese, Cantonese, Japanese, Korean and
# English, writing each in its own script. On clean sung phrases (GTSinger) it got 7% character error
# for Chinese, 34-45% for Japanese and 55% for Korean. It reports no token probabilities, so its words
# carry no confidence.
EAST_ASIAN = AsrModel(
    'east-asian', 'sensevoice-small-int8+silero-vad', 'lyrics-asr-sensevoice',
    'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2', 163002883,
    '7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e', {
        'model.int8.onnx': 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51',
        'tokens.txt': 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc',
        VAD_FILE: VAD_SHA256,
    })
# Whisper large-v3 turbo (OpenAI, MIT; int8) reads sung European lyrics better than Parakeet: on the first two
# minutes of five JamendoLyrics songs per language, word error fell from 42% to 35% in French, 28% to 22% in German
# and 43% to 15% in Spanish, but not in English (37.5% against 36%), and it was worse than SenseVoice on Chinese,
# Japanese and Korean. It reports no word times, so the multilingual model, which must be installed too, times its
# words; 79-94% of correctly heard words then started within 0.3 s of the singing, against 98-99% from Parakeet.
WHISPER = AsrModel(
    'whisper', 'whisper-turbo-int8+parakeet-tdt-0.6b-v3-timing', 'lyrics-asr-whisper',
    'sherpa-onnx-whisper-turbo.tar.bz2', 563790207,
    'b11acbbcd660b44a8e0df33724feb5aaa709cf65668f2823d59f656312544f22', {
        'turbo-encoder.int8.onnx': 'b02dcdf54f348741e93fe732b67d933c8dcb6735655f710640143081db38878b',
        'turbo-decoder.int8.onnx': '20accd02388482eb3a46bd615631adfdc85e1eb2c7db9ea3f02a40ffe6b81547',
        'turbo-tokens.txt': 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126',
        VAD_FILE: VAD_SHA256,
    })
ASR_MODELS = (ENGLISH, MULTILINGUAL, EAST_ASIAN, WHISPER)
EAST_ASIAN_CHOICES = {'chinese': 'zh', 'cantonese': 'yue', 'japanese': 'ja', 'korean': 'ko'}
CHOICES = ('auto', *(model.key for model in ASR_MODELS), *EAST_ASIAN_CHOICES)
KNOWN_MODELS = frozenset(model.name for model in ASR_MODELS)

# Language choice from the multilingual model's first words: function words that are English and
# not common words of the other languages it covers (so not "a", "in", "is", "so", "was", "will").
ENGLISH_MARKERS = frozenset("""
the and you to of my it that your we for with this are but not don't i'm it's can't won't i'll we're
you're they're i've just what when like yeah know get got never there they she his our out down if
let can be how why who where some heart only feel way think could would should through every
""".split())
DETECTION_WORDS = 100
# On 52 JamendoLyrics songs, the first 100 words of English songs were 28-46% markers; French,
# German and Spanish songs at most 9%.
ENGLISH_SHARE = 0.18
MAX_WORDS = 6000
MAX_TRANSCRIPT_BYTES = 1024 * 1024


_verified: dict[str, tuple] = {}


def model_ready(model_root: Path, model: AsrModel) -> bool:
    """All of ``model``'s pinned files present with matching SHA-256 (re-hashed only when a file's metadata changes)."""
    directory = Path(model_root) / model.directory
    try:
        stats = [(directory / name).stat(follow_symlinks=False) for name in model.files]
        signature = tuple((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) for info in stats)
    except OSError:
        return False
    if _verified.get(str(directory)) == signature:
        return True
    try:
        for name, expected in model.files.items():
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


def installed_models(model_root: Path) -> tuple[AsrModel, ...]:
    return tuple(model for model in ASR_MODELS if model_ready(model_root, model))


def selected_models(models: tuple[AsrModel, ...], choice: str = 'auto') -> tuple[AsrModel, ...]:
    """A deliberate retry choice never silently falls back to another installed model."""
    if not isinstance(choice, str) or choice not in CHOICES:
        raise ValueError('Choose a recognition model, or an explicit Chinese, Cantonese, Japanese or Korean retry.')
    # Whisper's words are timed by the multilingual model; without it, Whisper is not used.
    usable = tuple(model for model in models if model is not WHISPER or MULTILINGUAL in models)
    model_choice = 'east-asian' if choice in EAST_ASIAN_CHOICES else choice
    selected = usable if choice == 'auto' else (WHISPER, MULTILINGUAL) if choice == 'whisper' and WHISPER in usable \
        else tuple(model for model in usable if model.key == model_choice and model is not WHISPER)
    if not selected:
        option = '' if choice == 'auto' else ' --only whisper and --only multilingual' if choice == 'whisper' else f' --only {model_choice}'
        raise RuntimeError(f'The requested lyric recognition model is unavailable. Run scripts/setup_lyrics_model.py{option} with this studio’s model directory, then retry.')
    return selected


def asr_ready(model_root: Path) -> bool:
    """Automatic lyrics work with any recognizer; with several, each song gets the one that suits it."""
    return bool(installed_models(model_root))


def archive_model(archive: Path) -> AsrModel | None:
    """The model whose pinned archive size ``archive`` has (its checksum is verified before extraction)."""
    size = Path(archive).stat().st_size
    return next((model for model in ASR_MODELS if model.archive_bytes == size), None)


def _plain(word: str) -> str:
    return unicodedata.normalize('NFC', word.lower().replace('\u2019', "'")).strip('.,!?;:"()\'«»¿¡-')


def sounds_english(words: list[str]) -> bool:
    """Whether the first ``DETECTION_WORDS`` recognized words read as English."""
    sample = [_plain(word) for word in words[:DETECTION_WORDS]]
    sample = [word for word in sample if word]
    return len(sample) >= 5 and sum(word in ENGLISH_MARKERS for word in sample) >= ENGLISH_SHARE * len(sample)


# Chinese characters, Japanese kana and Korean Hangul.
_EAST_ASIAN = ((0x1100, 0x11FF), (0x3040, 0x30FF), (0x3130, 0x318F), (0x3400, 0x4DBF), (0x4E00, 0x9FFF),
               (0xAC00, 0xD7AF), (0xF900, 0xFAFF), (0x20000, 0x3134F))
EAST_ASIAN_SHARE = 0.5


def sounds_east_asian(words: list[str]) -> bool:
    """Whether the first ``DETECTION_WORDS`` recognized words are mostly written in Chinese, Japanese or Korean."""
    letters = [character for word in words[:DETECTION_WORDS] for character in word if character.isalpha()]
    inside = sum(1 for character in letters if any(low <= ord(character) <= high for low, high in _EAST_ASIAN))
    return len(letters) >= 5 and inside >= EAST_ASIAN_SHARE * len(letters)


def validate_transcript(value: object, duration: float) -> dict:
    """Strict shape for stored transcripts: model name, timed words and processing time."""
    if not isinstance(value, dict) or set(value) != {'model', 'words', 'seconds'}:
        raise ValueError('The lyric transcript has an unexpected shape.')
    if value['model'] not in KNOWN_MODELS:
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
    return dict(model=value['model'], words=words, seconds=float(seconds))


def transcribe_vocals(vocals: Path, output: Path, model_root: Path, duration: float,
                      cancel: threading.Event, stage: Callable[[str], None], *, model_choice: str = 'auto') -> dict:
    """Write ``output`` (a new transcript JSON) and return the validated transcript."""
    selected_models(installed_models(model_root), model_choice)
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
              '--output', str(output), '--model-root', str(Path(model_root).resolve()), '--model-choice', model_choice],
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
