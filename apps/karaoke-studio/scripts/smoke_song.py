"""Run production separation and lyric recognition on a pinned short singing example.

No models or media are bundled. Setup is explicit; inference uses the normal offline workers.
A pass establishes execution and valid nonempty output, not WER or user correction effort.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile
import threading
import time
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from karaoke.limits import MAX_WORKER_RSS_KIB, SAMPLE_RATE  # noqa: E402
from karaoke.lyrics_auto import words_to_cues  # noqa: E402
from karaoke.model import create_project, validate_project  # noqa: E402
from karaoke.pipeline import MODEL_NAME, MODEL_SHA256, _run, separate_clip  # noqa: E402
from karaoke.transcription import ENGLISH, transcribe_vocals, validate_transcript  # noqa: E402
from scripts.smoke_model import check_outputs  # noqa: E402

SOURCE_REVISION = '556ef2121492d72398a988af1b38b55176f5973a'
SOURCE_URL = f'https://raw.githubusercontent.com/deezer/spleeter/{SOURCE_REVISION}/audio_example.mp3'
SOURCE_BYTES = 262867
SOURCE_SHA256 = '4b431d535d235bd81b62f816f08c3f1afb6679d2706d84b3b75903b7df909507'
SECONDS = 10
ATTRIBUTION = ('Slow Motion Dream by Steven M Bryant, copyright 2011; '
               'Ft CSoul, Alex Beroza & Robert Siekawitch. CC BY 3.0: '
               'http://dig.ccmixter.org/files/stevieb357/34740 . '
               'Official Spleeter example; this smoke takes its opening 10 seconds and estimates stems.')


def admit_sample(raw: bytes) -> dict:
    if len(raw) != SOURCE_BYTES or hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError('Singing sample size or SHA-256 differs from the pinned upstream example.')
    return dict(url=SOURCE_URL, revision=SOURCE_REVISION, bytes=SOURCE_BYTES,
                sha256=SOURCE_SHA256, attribution=ATTRIBUTION)


def check_recognition(transcript: dict, duration: float, processing: dict) -> dict:
    if type(duration) not in (int, float) or not math.isfinite(duration) or abs(duration - SECONDS) > 1 / SAMPLE_RATE:
        raise RuntimeError('The real-song smoke must use its exact ten-second clip.')
    transcript = validate_transcript(transcript, duration)
    if transcript['model'] != ENGLISH.name or not transcript['words']:
        raise RuntimeError('The real English model must produce nonempty recognized words.')
    if processing.get('model') != MODEL_NAME or processing.get('modelSha256') != MODEL_SHA256:
        raise RuntimeError('Separation did not report the checksum-pinned production model.')
    attempts, rss = processing.get('offlineNetworkAttempts'), processing.get('peakRssKiB')
    if type(attempts) is not int or attempts != 0:
        raise RuntimeError('Separation attempted network access or omitted offline provenance.')
    if type(rss) is not int or not 0 < rss <= MAX_WORKER_RSS_KIB:
        raise RuntimeError('Separation omitted valid memory provenance or exceeded its resource limit.')
    project = create_project('f' * 32, 'Real-song CI smoke', duration)
    project = validate_project({**project, 'cues': words_to_cues(transcript['words'], duration)})
    if not project['cues']:
        raise RuntimeError('Recognized words did not produce valid automatic lyric cues.')
    return dict(recognizer=transcript['model'], recognizedWords=len(transcript['words']),
                automaticCues=len(project['cues']), recognitionSeconds=transcript['seconds'],
                separationPeakRssKiB=rss, separationNetworkAttempts=attempts)


def run(model_dir: Path, work_dir: Path, source: Path | None = None) -> dict:
    # A unique generated child keeps prior attempts and caller-owned media intact.
    work_dir.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix='real-song-', dir=work_dir))
    if source is None:
        with urllib.request.urlopen(SOURCE_URL, timeout=30) as response:
            raw = response.read(SOURCE_BYTES + 1)
    else:
        if source.is_symlink() or not source.is_file() or source.stat().st_size != SOURCE_BYTES:
            raise ValueError('Provide the regular, exact-size pinned singing sample.')
        raw = source.read_bytes()
    provenance = admit_sample(raw)
    original = directory / 'source.mp3'
    original.write_bytes(raw)
    clip = directory / 'clip.wav'
    cancel = threading.Event()
    started = time.monotonic()
    _run(['ffmpeg', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', 'mp3',
          '-i', str(original), '-t', str(SECONDS), '-ar', str(SAMPLE_RATE), '-ac', '2', '-c:a', 'pcm_s16le', str(clip)],
         cancel, timeout=60)
    media = directory / 'media'
    def stage(message):
        print(message, flush=True)
    duration = separate_clip(clip, media, model_dir, cancel, stage)
    pcm = check_outputs(media, round(duration * SAMPLE_RATE))
    transcript = transcribe_vocals(media / 'vocals.wav', directory / 'transcript.json', model_dir,
                                   duration, cancel, stage, model_choice='english')
    processing = json.loads((media / 'processing.json').read_text())
    result = check_recognition(transcript, duration, processing)
    report = dict(status='passed', scope='real-model execution; not recognition quality acceptance',
                  source=provenance, duration=duration, pcmPeaks=pcm,
                  separator=MODEL_NAME, separatorSha256=MODEL_SHA256,
                  recognizerFiles=ENGLISH.files, elapsedSeconds=round(time.monotonic()-started, 3), **result)
    (directory / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', type=Path)
    parser.add_argument('--work-dir', type=Path, help='Generated media/reports outside Git; prior attempts are preserved')
    parser.add_argument('--source', type=Path, help='Reuse the exact pinned official sample instead of downloading it')
    parser.add_argument('--check-source', action='store_true', help='Verify --source without models or inference')
    args = parser.parse_args()
    if args.check_source:
        if args.source is None:
            parser.error('--check-source requires --source')
        if args.source.is_symlink() or not args.source.is_file() or args.source.stat().st_size != SOURCE_BYTES:
            parser.error('--source must be the regular, exact-size official sample')
        print(json.dumps(admit_sample(args.source.read_bytes()), indent=2))
    else:
        if args.model_dir is None or args.work_dir is None:
            parser.error('--model-dir and --work-dir are required for real inference')
        print(json.dumps(run(args.model_dir.resolve(), args.work_dir.resolve(), args.source), indent=2))


if __name__ == '__main__':
    main()
