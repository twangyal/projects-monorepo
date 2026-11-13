"""Bounded passage recognition; pending readings never replace a full-song reference."""
import math
from pathlib import Path
import threading

from .pipeline import _run
from .lyrics_auto import words_to_cues
from .transcription import validate_transcript

PASSAGE_FILE = 'recognition-passage.json'
MAX_PASSAGE_SECONDS = 60


def passage_range(start, end, duration):
    if (type(start) not in (int, float) or type(end) not in (int, float)
            or not math.isfinite(start) or not math.isfinite(end)
            or not 0 <= start < end <= duration or not 1 <= end - start <= MAX_PASSAGE_SECONDS):
        raise ValueError('Choose a passage of 1–60 seconds inside this clip.')
    return float(start), float(end)


def crop_vocals(source: Path, output: Path, start: float, end: float, cancel: threading.Event):
    # Inputs and output live under owned media directory descriptors inherited by FFmpeg.
    _run(['ffmpeg', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-f', 'wav',
          '-ss', f'{start:.6f}', '-t', f'{end - start:.6f}', '-i', str(source),
          '-map', '0:a:0', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', '-f', 'wav', str(output)],
         cancel, timeout=60)


def passage_result(value, start, end):
    transcript = validate_transcript(value, end - start)
    # Recognition permits a half-second tail. Clip it to the actual excerpt before shifting to song time.
    words = [{**word, 'start': word['start'] + start, 'end': min(word['end'] + start, end)}
             for word in transcript['words'] if word['start'] < end - start and word['end'] > word['start']]
    words = [word for word in words if word['start'] < word['end']]
    return validate_passage({'start': start, 'end': end, 'transcript': {**transcript, 'words': words}}, end)


def validate_passage(value, duration):
    if not isinstance(value, dict) or set(value) != {'start', 'end', 'transcript'}:
        raise ValueError('Invalid stored passage preview.')
    start, end = passage_range(value['start'], value['end'], duration)
    transcript = validate_transcript(value['transcript'], duration)
    if any(not start <= word['start'] < word['end'] <= end for word in transcript['words']):
        raise ValueError('Stored passage words are outside their passage.')
    return {'start': start, 'end': end, 'transcript': transcript}


def passage_reply(value, duration):
    value = validate_passage(value, duration)
    start, end, transcript = value['start'], value['end'], value['transcript']
    cues = words_to_cues(transcript['words'], duration, confidence=True)
    # Grouping pads short words and rounds detail to milliseconds. Bound the displayed representation too.
    for cue in cues:
        cue['start'], cue['end'] = max(start, cue['start']), min(end, cue['end'])
        for word in cue['words']:
            word['start'] = max(start, min(end, word['start']))
            word['end'] = max(start, min(end, word['end']))
    return {'available': True, 'model': transcript['model'], 'words': len(transcript['words']), 'cues': cues}
