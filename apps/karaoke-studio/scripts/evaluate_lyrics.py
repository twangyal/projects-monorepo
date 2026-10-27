"""Measure automatic lyrics on real songs with word-level reference timings.

Uses a local checkout of the JamendoLyrics dataset (https://github.com/f90/jamendolyrics, MIT
code; Creative Commons songs). Audio is never committed. Each song in ``--language`` (English by
default; the dataset also has French, German and Spanish) runs through the
production path: ``separate_clip`` (decode + MDX-Net vocal separation) then ``transcribe_vocals`` (VAD + Parakeet).
Songs longer than ``--max-seconds`` (default: the app's limit) are evaluated on their first ``--max-seconds``.
The #214 baseline used 300 s; pass ``--max-seconds 300`` to compare with it.

Reports, per song and overall:
- word error rate (WER) of recognized words against the reference lyrics;
- onset error of correctly recognized words against annotated word starts;
- automatic lines: share of reference line starts with an automatic line start within 1 s;
- supplied lyrics: start error of each aligned reference line against its annotated start.

Usage (Python 3.11 environment with requirements-ml.lock.txt and both models installed):
    python scripts/evaluate_lyrics.py --dataset ../jamendolyrics --model-dir MODELS --work WORK
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import math
import json
from pathlib import Path
import statistics
import subprocess
import sys
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from karaoke.limits import MAX_DURATION  # noqa: E402
from karaoke.transcription import CHOICES  # noqa: E402
from karaoke.lyrics_auto import LEAD_IN, _align, _token, align_lines, words_to_cues  # noqa: E402


def edit_distance(a: list[str], b: list[str]) -> int:
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x != y)))
        previous = current
    return previous[-1]


def process(song: Path, work: Path, model_dir: Path, max_seconds: float = MAX_DURATION,
            *, model_choice: str = 'auto') -> dict:
    from karaoke.pipeline import MODEL_SHA256, separate_clip
    from karaoke.transcription import installed_models, selected_models, transcribe_vocals, validate_transcript
    if type(max_seconds) not in (int, float) or not math.isfinite(max_seconds) or not 1 <= max_seconds <= MAX_DURATION:
        raise ValueError(f'Evaluation length must be 1–{MAX_DURATION} seconds.')
    models = selected_models(installed_models(model_dir), model_choice)

    def digest(path):
        with path.open('rb') as source:
            return hashlib.file_digest(source, 'sha256').hexdigest()

    def identity(value):
        return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()

    app = Path(__file__).resolve().parents[1] / 'karaoke'
    # Source bytes and bounded production configuration identify the separated vocals. Model
    # comparisons share those same vocals, but never another clip length or input song.
    clip = dict(audioSha256=digest(song), maxSeconds=max_seconds, separatorSha256=MODEL_SHA256,
                implementation={name: digest(app / name) for name in ('pipeline.py', 'worker.py', 'mdx.py', 'chunks.py', 'limits.py')})
    work = work / 'clips' / identity(clip)
    recognition = dict(modelChoice=model_choice, models={model.name: model.files for model in models},
                       implementation={name: digest(app / name) for name in ('transcription.py', 'transcribe_worker.py')})
    result, separated = work / f'transcript-{identity(recognition)}.json', work / 'separation.json'
    if result.exists():
        value = json.loads(result.read_text())
        duration = value['duration']
        if not 0 < duration <= max_seconds:
            raise ValueError('Cached evaluation duration exceeds this clip bound.')
        validate_transcript({key: value[key] for key in ('model', 'words', 'seconds')}, duration)
        if value['model'] not in {model.name for model in models}:
            raise ValueError('Cached evaluation transcript came from another recognizer.')
        return value
    media = work / 'media'
    cancel = threading.Event()
    if separated.exists():
        duration = json.loads(separated.read_text())['duration']
    else:
        work.mkdir(parents=True, exist_ok=True)
        source = work / 'input.wav'
        # Bounded copy: the app refuses clips over its limit rather than trimming them.
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(song), '-t', str(max_seconds), '-ac', '2', '-ar', '44100',
                        '-c:a', 'pcm_s16le', str(source)], check=True)
        duration = separate_clip(source, media, model_dir, cancel, lambda _s: None)
        separated.write_text(json.dumps({'duration': duration, **clip}))
        for name in ('source.wav', 'backing.wav'):
            (media / name).unlink(missing_ok=True)
        source.unlink()
    (work / 'words.json').unlink(missing_ok=True)
    transcript = transcribe_vocals(media / 'vocals.wav', work / 'words.json', model_dir, duration, cancel,
                                   lambda _s: None, model_choice=model_choice)
    value = dict(duration=duration, audioSha256=clip['audioSha256'], maxSeconds=max_seconds,
                 modelChoice=model_choice, cacheIdentity=dict(clip=identity(clip), recognition=identity(recognition)), **transcript)
    result.write_text(json.dumps(value))
    return value


def share(values: list[float], limit: float) -> float | None:
    return round(sum(v <= limit for v in values) / len(values), 3) if values else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', type=Path, required=True)
    parser.add_argument('--model-dir', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--max-seconds', type=float, default=MAX_DURATION)
    parser.add_argument('--language', default='English', help='JamendoLyrics language: English, French, German or Spanish')
    parser.add_argument('--model-choice', choices=CHOICES, default='auto')
    parser.add_argument('--limit', type=int, help='Only the first N songs of the language (in dataset order)')
    args = parser.parse_args()
    rows = [r for r in csv.DictReader((args.dataset / 'JamendoLyrics.csv').open()) if r['Language'] == args.language][:args.limit]
    totals = dict(errors=0, reference=0)
    onsets, line_errors, auto_hits, auto_lines, report = [], [], 0, 0, []
    confidence_pairs, heard_lines = [], []
    for row in rows:
        name = Path(row['Filepath']).stem
        transcript = process(args.dataset / 'mp3' / row['Filepath'], args.work / name, args.model_dir, args.max_seconds, model_choice=args.model_choice)
        duration, words = transcript['duration'], transcript['words']
        timing = list(csv.DictReader((args.dataset / 'annotations' / 'words' / f'{name}.csv').open()))
        reference_words = (args.dataset / 'lyrics' / f'{name}.words.txt').read_text().split()
        pairs = [(w, float(t['word_start'])) for w, t in zip(reference_words, timing) if float(t['word_start']) < duration]
        lines = [line for line in csv.DictReader((args.dataset / 'annotations' / 'lines' / f'{name}.csv').open())
                 if float(line['end_time']) <= duration]
        reference = [_token(w) for w, _ in pairs]
        heard_words = [w for w in words if _token(w['text'])]
        heard = [_token(w['text']) for w in heard_words]
        errors = edit_distance(reference, heard)
        totals['errors'] += errors
        totals['reference'] += len(reference)
        matches = _align(reference, heard)
        song_onsets = [abs(heard_words[j]['start'] - pairs[i][1]) for i, j in enumerate(matches)
                       if j is not None and reference[i] == heard[j]]
        onsets += song_onsets
        correct = {j for i, j in enumerate(matches) if j is not None and reference[i] == heard[j]}
        confidence_pairs += [(word['confidence'], index in correct) for index, word in enumerate(heard_words)]
        starts = [cue['start'] + LEAD_IN for cue in words_to_cues(words, duration)]
        hits = sum(1 for line in lines if any(abs(s - float(line['start_time'])) <= 1 for s in starts))
        auto_hits += hits
        auto_lines += len(lines)
        aligned = align_lines([line['lyrics_line'] for line in lines], words, duration)
        song_lines = ([abs(cue['start'] + LEAD_IN - float(line['start_time'])) for cue, line in zip(aligned, lines)]
                      if len(aligned) == len(lines) else [])
        line_errors += song_lines
        heard_lines += [(cue['matched'] >= 0.5, error) for cue, error in zip(aligned, song_lines)]
        report.append(dict(
            song=name, model=transcript['model'], modelChoice=args.model_choice, audioSha256=transcript['audioSha256'],
            cacheIdentity=transcript['cacheIdentity'], genre=row['Genre'], polyphonic=row['Polyphonic'] == 'true', seconds=round(duration, 1),
            wer=round(errors / len(reference), 3), onsetMedian=round(statistics.median(song_onsets), 3) if song_onsets else None,
            automaticLineStartsWithin1s=round(hits / len(lines), 3) if lines else None,
            alignedLineStartMedian=round(statistics.median(song_lines), 3) if song_lines else None,
            alignedWithin1s=share(song_lines, 1), recognitionSeconds=round(transcript['seconds'], 1)))
        print(json.dumps(report[-1]), flush=True)
    summary = dict(
        language=args.language, maxSeconds=args.max_seconds, modelChoice=args.model_choice,
        models=sorted({r["model"] for r in report}), songs=len(report), referenceWords=totals['reference'], wer=round(totals['errors'] / totals['reference'], 3),
        medianSongWer=round(statistics.median(r['wer'] for r in report), 3),
        wordOnsetMedian=round(statistics.median(onsets), 3), wordOnsetWithin0_3s=share(onsets, .3), wordOnsetWithin1s=share(onsets, 1),
        automaticLineStartsWithin1s=round(auto_hits / auto_lines, 3),
        alignedLines=len(line_errors), alignedLineStartMedian=round(statistics.median(line_errors), 3),
        alignedWithin0_5s=share(line_errors, .5), alignedWithin1s=share(line_errors, 1), alignedWithin2s=share(line_errors, 2),
        recognitionSecondsPerAudioSecond=round(sum(r['recognitionSeconds'] for r in report) / sum(r['seconds'] for r in report), 3),
        alignedHeardShare=round(sum(h for h, _ in heard_lines) / len(heard_lines), 3),
        alignedHeardWithin1s=share([e for h, e in heard_lines if h], 1), alignedUnheardWithin1s=share([e for h, e in heard_lines if not h], 1),
        # How often a recognized word is right, below and above confidence thresholds.
        wordCorrectByConfidence={str(t): dict(belowShare=round(sum(c < t for c, _ in confidence_pairs) / len(confidence_pairs), 3),
                                              correctBelow=share([0 if ok else 1 for c, ok in confidence_pairs if c < t], 0),
                                              correctAtOrAbove=share([0 if ok else 1 for c, ok in confidence_pairs if c >= t], 0))
                                 for t in (0.5, 0.7, 0.8, 0.9)})
    print(json.dumps(summary), flush=True)
    if args.output:
        args.output.write_text(json.dumps(dict(summary=summary, songs=report), indent=2) + '\n')


if __name__ == '__main__':
    main()
