"""Bounded, offline imports of explicitly unverified discussion excerpts."""
from dataclasses import asdict
import json
import os
from pathlib import Path
import re
import stat
from urllib.parse import urlsplit

from .model import ContextEntry, Report
from .synopsis import commit_anchor

MAX_CONTEXT_BYTES = 256 * 1024
MAX_CONTEXT_ENTRIES = 50
PROVENANCE = (
    'Unverified supplied context. Authors, source labels, URLs and excerpts were provided '
    'locally; their authenticity, relevance and claims have not been verified. No discussion '
    'was fetched, and these excerpts do not establish author intent.'
)
_FIELDS = {'commit', 'source', 'url', 'author', 'excerpt'}
_FULL_COMMIT = re.compile(r'(?:[0-9a-f]{40}|[0-9a-f]{64})\Z')
_COMPONENT = re.compile(r'[A-Za-z0-9_.-]+\Z')


def represented_commits(report: Report) -> set[str]:
    return {report.revision, *(item.commit for item in report.blame),
            *(item.commit for item in report.changes), *(item.commit for item in report.renames)}


def _discussion_url(value: str) -> str:
    """Accept recognizable public discussion routes without hidden credentials."""
    invalid = ValueError('URL must be a credential-free HTTPS GitHub/GitLab PR, issue, or discussion link.')
    if (any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value)
            or any(char in value for char in ('?', '%', '\\'))):
        raise invalid
    try:
        parsed = urlsplit(value)
    except ValueError:
        raise invalid from None
    if (parsed.scheme != 'https' or parsed.netloc not in ('github.com', 'gitlab.com')
            or parsed.query or parsed.username is not None or parsed.password is not None):
        raise invalid
    parts = parsed.path.split('/')[1:]
    if any(not _COMPONENT.fullmatch(part) or part in ('.', '..') for part in parts):
        raise invalid
    if parsed.netloc == 'github.com':
        if (len(parts) != 4 or parts[2] not in ('pull', 'issues', 'discussions')
                or not re.fullmatch(r'[1-9][0-9]*', parts[3])):
            raise invalid
        fragments = {
            'pull': r'(?:issuecomment-[0-9]+|discussion_r[0-9]+|pullrequestreview-[0-9]+)',
            'issues': r'issuecomment-[0-9]+',
            'discussions': r'discussioncomment-[0-9]+',
        }
        if parsed.fragment and not re.fullmatch(fragments[parts[2]], parsed.fragment):
            raise invalid
    else:
        if (len(parts) < 5 or parts[-3] != '-' or '-' in parts[:-3]
                or parts[-2] not in ('merge_requests', 'issues')
                or not re.fullmatch(r'[1-9][0-9]*', parts[-1])):
            raise invalid
        if parsed.fragment and not re.fullmatch(r'note_[0-9]+', parsed.fragment):
            raise invalid
    return value


def _text(value: object, maximum: int, field: str, index: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f'Context entry {index} {field} must contain 1–{maximum} characters.')
    if any(ord(char) < 32 and char not in '\n\r\t' or ord(char) == 127 for char in value):
        raise ValueError(f'Context entry {index} {field} contains unsupported control characters.')
    try:
        value.encode('utf-8')
    except UnicodeError:
        raise ValueError(f'Context entry {index} {field} must contain valid Unicode text.') from None
    return value


def _validate_document(value: object, report: Report) -> list[ContextEntry]:
    if not isinstance(value, dict) or set(value) != {'schema_version', 'entries'}:
        raise ValueError('Context JSON must contain exactly schema_version and entries.')
    if type(value['schema_version']) is not int or value['schema_version'] != 1:
        raise ValueError('Unsupported context schema_version; use version 1.')
    entries = value['entries']
    if not isinstance(entries, list) or len(entries) > MAX_CONTEXT_ENTRIES:
        raise ValueError('Context entries must be an array of at most 50 records.')
    known = represented_commits(report)
    result = []
    for index, item in enumerate(entries, 1):
        if not isinstance(item, dict) or set(item) != _FIELDS:
            raise ValueError(f'Context entry {index} must contain exactly commit, source, url, author, and excerpt.')
        commit = item['commit']
        if not isinstance(commit, str) or not _FULL_COMMIT.fullmatch(commit):
            raise ValueError(f'Context entry {index} commit must be a full lowercase 40- or 64-character commit ID.')
        if commit not in known:
            raise ValueError(f'Context entry {index} commit is not represented in this report; choose the matching --ref/range or remove stale context.')
        source = _text(item['source'], 200, 'source', index)
        author = _text(item['author'], 200, 'author', index)
        excerpt = _text(item['excerpt'], 4000, 'excerpt', index)
        url = _text(item['url'], 2048, 'URL', index)
        try:
            url = _discussion_url(url)
        except ValueError as exc:
            raise ValueError(f'Context entry {index} {exc}') from None
        result.append(ContextEntry(commit, source, url, author, excerpt))
    # Also enforce this bound for direct renderer callers, who bypass file reads.
    if len(json.dumps(value, ensure_ascii=False).encode('utf-8')) > MAX_CONTEXT_BYTES:
        raise ValueError('Context exceeds 256 KiB; supply fewer or shorter excerpts.')
    return result


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate context JSON fields are not supported.')
        result[key] = value
    return result


def _invalid_constant(value: str) -> None:
    raise ValueError('Context JSON must not contain nonstandard numeric constants.')


def load_context(path: str | Path, report: Report) -> list[ContextEntry]:
    """Read one regular file with bounded allocation, without following URLs."""
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
        with os.fdopen(descriptor, 'rb') as stream:
            metadata = os.fstat(stream.fileno())
            if not stat.S_ISREG(metadata.st_mode):
                raise ValueError('Context must be a regular UTF-8 JSON file.')
            if metadata.st_size > MAX_CONTEXT_BYTES:
                raise ValueError('Context file exceeds 256 KiB; supply fewer or shorter excerpts.')
            raw = stream.read(MAX_CONTEXT_BYTES + 1)
    except OSError:
        raise ValueError('Cannot read context file; choose an existing readable regular UTF-8 JSON file.') from None
    if len(raw) > MAX_CONTEXT_BYTES:
        raise ValueError('Context file exceeds 256 KiB; supply fewer or shorter excerpts.')
    try:
        document = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique_object,
                              parse_constant=_invalid_constant)
    except (UnicodeError, ValueError, RecursionError):
        raise ValueError('Context file must contain valid UTF-8 JSON with unique fields and standard values.') from None
    return _validate_document(document, report)


def context_document(report: Report, entries: list[ContextEntry]) -> dict:
    """Revalidate a public rendering boundary and add explicit evidence links."""
    if (not isinstance(entries, list) or len(entries) > MAX_CONTEXT_ENTRIES
            or any(not isinstance(entry, ContextEntry) for entry in entries)):
        raise ValueError('Supplied context must contain at most 50 validated context entries.')
    valid = _validate_document({'schema_version': 1, 'entries': [asdict(item) for item in entries]}, report)
    return {'schema_version': 1, 'provenance': PROVENANCE,
            'entries': [{**asdict(item), 'evidence_anchor': commit_anchor(item.commit)} for item in valid]}
