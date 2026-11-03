"""Measure word-by-word highlighting on real songs against annotated word starts.

Uses the same JamendoLyrics checkout, production path and cached work directory as
``evaluate_lyrics.py`` (separation + recognition run once per song). For every reference word of
the songs in ``--language``, it compares the time ``word_timings`` lights the word up with its
annotated start, in these situations:

- ``timedLines``: reference lines with their annotated start/end times (lines a person timed well),
  word times from recognition (``timedLinesHeard`` and ``timedLinesUnheard`` split them);
- ``timedLinesForced``: the same lines laid on the letters measured in the vocals, as the studio does
  with the lyric aligner installed; ``timedLinesHybrid`` keeps recognized times for heard words;
- ``alignedLines``: the reference lyrics pasted and aligned automatically with ``align_lines``;
- ``estimatedOnly``: the timed lines without recognized words (the fallback, as a baseline).

Usage (Python 3.11 environment with requirements-ml.lock.txt and both models installed):
    python scripts/evaluate_word_highlighting.py --dataset ../jamendolyrics --model-dir MODELS --work WORK
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import statistics
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from evaluate_lyrics import measured_letters, process, share  # noqa: E402
from karaoke.alignment import aligner_ready, force_words  # noqa: E402
from karaoke.limits import MAX_DURATION  # noqa: E402
from karaoke.lyrics_auto import align_lines, word_timings  # noqa: E402


def summary(errors: list[float]) -> dict:
    return dict(words=len(errors), median=round(statistics.median(errors), 3) if errors else None,
                within0_2s=share(errors, .2), within0_3s=share(errors, .3), within0_5s=share(errors, .5), within1s=share(errors, 1))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', type=Path, required=True)
    parser.add_argument('--model-dir', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--language', default='English')
    parser.add_argument('--max-seconds', type=float, default=MAX_DURATION)
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    rows = [r for r in csv.DictReader((args.dataset / 'JamendoLyrics.csv').open()) if r['Language'] == args.language][:args.limit]
    totals = {key: [] for key in ('timedLines', 'alignedLines', 'estimatedOnly', 'timedLinesHeard', 'timedLinesUnheard',
                                  'timedLinesForced', 'timedLinesHybrid', 'timedLinesForcedUnheard')}
    aligner = aligner_ready(args.model_dir)
    songs, skipped = [], []
    for row in rows:
        name = Path(row['Filepath']).stem
        transcript = process(args.dataset / 'mp3' / row['Filepath'], args.work / name, args.model_dir, args.max_seconds)
        duration, words = transcript['duration'], transcript['words']
        starts = [float(w['word_start']) for w in csv.DictReader((args.dataset / 'annotations' / 'words' / f'{name}.csv').open())]
        lines = list(csv.DictReader((args.dataset / 'annotations' / 'lines' / f'{name}.csv').open()))
        # Reference words, in order, belong to the reference lines in order.
        if sum(len(line['lyrics_line'].split()) for line in lines) != len(starts):
            skipped.append(name)
            continue
        cues, reference, cursor = [], [], 0
        for line in lines:
            count = len(line['lyrics_line'].split())
            line_starts = starts[cursor:cursor + count]
            cursor += count
            start, end = float(line['start_time']), float(line['end_time'])
            # Songs over the app's limit are evaluated on their first 300 s, so later lines are skipped.
            if end > duration or start >= end:
                continue
            cues.append(dict(start=start, end=end, text=line['lyrics_line']))
            reference.append(line_starts)
        # Annotated lines can touch; keep them ordered and non-overlapping as the app requires.
        for previous, cue in zip(cues, cues[1:]):
            previous['end'] = min(previous['end'], cue['start'])
        song = {}
        timed = word_timings(cues, words, duration)
        estimated = word_timings(cues, [], duration)
        for key, result in (('timedLines', timed), ('estimatedOnly', estimated)):
            errors = [abs(word['start'] - truth) for line, truths in zip(result, reference) for word, truth in zip(line, truths)]
            totals[key] += errors
            song[key] = round(statistics.median(errors), 3) if errors else None
        for line, truths in zip(timed, reference):
            for word, truth in zip(line, truths):
                totals['timedLinesHeard' if word['heard'] else 'timedLinesUnheard'].append(abs(word['start'] - truth))
        # Laid on the letters measured in the vocals, within each timed line; and with heard words kept as recognized.
        letters = measured_letters(Path(transcript['clipDirectory']), args.model_dir, duration) if aligner else None
        if letters is not None:
            for cue, line, truths in zip(cues, timed, reference):
                forced = force_words(cue['text'], letters, cue['start'], cue['end'])
                for k, (word, truth) in enumerate(zip(line, truths)):
                    at = min(max(forced[k], cue['start']), cue['end']) if forced and len(forced) == len(line) else word['start']
                    totals['timedLinesForced'].append(abs(at - truth))
                    totals['timedLinesHybrid'].append(abs((word['start'] if word['heard'] else at) - truth))
                    if not word['heard']:
                        totals['timedLinesForcedUnheard'].append(abs(at - truth))
        aligned = align_lines([cue['text'] for cue in cues], words, duration)
        if len(aligned) == len(cues):
            errors = [abs(word['start'] - truth) for line, truths in zip(word_timings(aligned, words, duration), reference)
                      for word, truth in zip(line, truths)]
            totals['alignedLines'] += errors
            song['alignedLines'] = round(statistics.median(errors), 3) if errors else None
        songs.append(dict(song=name, genre=row['Genre'], words=sum(len(r) for r in reference), **song))
        print(json.dumps(songs[-1]), flush=True)
    result = dict(summary={key: summary(values) for key, values in totals.items()}, songs=songs, skipped=skipped,
                  heardShare=round(len(totals['timedLinesHeard']) / max(1, len(totals['timedLines'])), 3))
    print(json.dumps(result['summary']), flush=True)
    if args.output:
        args.output.write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
