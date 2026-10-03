"""Validated local karaoke projects and explicitly draft lyric timings."""
import html
import math
import re

MAX_DURATION = 30
MIN_DURATION = 1
MAX_CUES = 40
MAX_LYRIC_CHARS = 5000


class ValidationError(ValueError):
    """A project or edit cannot be represented safely."""


def _number(value: object, label: str) -> float:
    if type(value) not in (int, float):
        raise ValidationError(f'{label} must be a finite number.')
    try:
        result = float(value)
    except (OverflowError, ValueError) as exc:
        raise ValidationError(f'{label} must be a finite number.') from exc
    if not math.isfinite(result):
        raise ValidationError(f'{label} must be a finite number.')
    return result


def _duration(value: object) -> float:
    duration = _number(value, 'Duration')
    if not MIN_DURATION <= duration <= MAX_DURATION:
        raise ValidationError('Duration must be between 1 and 30 seconds.')
    return duration


def _text(value: object, limit: int, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit or '\x00' in value:
        raise ValidationError(f'{label} must contain 1–{limit} characters without NUL bytes.')
    try:
        value.encode('utf-8')
    except UnicodeEncodeError as exc:
        raise ValidationError(f'{label} must contain valid Unicode text.') from exc
    return value


def create_project(project_id: str, title: str, duration: float) -> dict:
    return validate_project(dict(schemaVersion=1, id=project_id, title=title,
                                 duration=duration, revision=0, cues=[]))


def validate_project(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValidationError('Project must be an object.')
    if type(value.get('schemaVersion')) is not int or value['schemaVersion'] != 1:
        raise ValidationError('Unsupported project schema version.')
    project_id = value.get('id')
    if not isinstance(project_id, str) or not re.fullmatch(r'[0-9a-f]{32}', project_id):
        raise ValidationError('Project ID must contain 32 lowercase hexadecimal characters.')
    title = _text(value.get('title'), 100, 'Title')
    duration = _duration(value.get('duration'))
    revision = value.get('revision')
    if type(revision) is not int or revision < 0:
        raise ValidationError('Project revision must be a nonnegative integer.')
    incoming = value.get('cues')
    if not isinstance(incoming, list) or len(incoming) > MAX_CUES:
        raise ValidationError('Provide at most 40 lyric cues.')
    cues = []
    previous_end = 0.0
    characters = 0
    for index, cue in enumerate(incoming):
        if not isinstance(cue, dict):
            raise ValidationError(f'Cue {index + 1} must be an object.')
        start = _number(cue.get('start'), f'Cue {index + 1} start')
        end = _number(cue.get('end'), f'Cue {index + 1} end')
        if not 0 <= start < end <= duration or start < previous_end:
            raise ValidationError('Cue intervals must be ordered, nonoverlapping, and inside the clip duration.')
        text = _text(cue.get('text'), 240, f'Cue {index + 1} text')
        characters += len(text)
        if characters > MAX_LYRIC_CHARS:
            raise ValidationError('Lyrics must contain at most 5000 characters.')
        cues.append(dict(start=start, end=end, text=text))
        previous_end = end
    return dict(schemaVersion=1, id=project_id, title=title, duration=duration,
                revision=revision, cues=cues)


def update_project(project: dict, title: str, cues: list, expected_revision: int) -> dict:
    current = validate_project(project)
    if type(expected_revision) is not int or expected_revision != current['revision']:
        raise ValidationError('Project revision is stale; reload before saving.')
    return validate_project({**current, 'title': title, 'cues': cues,
                             'revision': current['revision'] + 1})


def draft_cues(text: str, duration: float) -> list[dict]:
    duration = _duration(duration)
    if not isinstance(text, str) or len(text) > MAX_LYRIC_CHARS:
        raise ValidationError('Draft lyrics must be a string of at most 5000 characters.')
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) > MAX_CUES:
        raise ValidationError('Draft lyrics must have at most 40 nonempty lines.')
    for line in lines:
        _text(line, 240, 'Lyric line')
    if not lines:
        return []
    return [dict(start=duration * index / len(lines),
                 end=duration * (index + 1) / len(lines), text=line)
            for index, line in enumerate(lines)]


def _srt_time(milliseconds: int) -> str:
    seconds, milliseconds = divmod(milliseconds, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f'{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}'


def render_srt(project: dict) -> str:
    project = validate_project(project)
    blocks = []
    for index, cue in enumerate(project['cues'], 1):
        start = math.floor(cue['start'] * 1000 + 0.5)
        end = max(start + 1, math.floor(cue['end'] * 1000 + 0.5))
        # Escape subtitle markup and remove internal blank separators so lyrics
        # cannot introduce another SRT block. No lyric text is evaluated.
        text = '\n'.join(html.escape(line, quote=False) for line in cue['text'].splitlines() if line.strip())
        blocks.append(f'{index}\n{_srt_time(start)} --> {_srt_time(end)}\n{text}\n')
    return '\n'.join(blocks)
