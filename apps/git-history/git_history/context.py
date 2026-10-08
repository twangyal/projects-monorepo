"""Bounded, offline imports of explicitly unverified discussion excerpts."""
from dataclasses import asdict
import json
import os
from pathlib import Path
import re
import stat
from urllib.parse import urlsplit

from .model import ContextEntry, Report, SuppliedContext
from .synopsis import commit_anchor
from .work_budget import check_work_budget

MAX_CONTEXT_BYTES = 256 * 1024
MAX_CONTEXT_ENTRIES = 50
MAX_CONTEXT_RECORDS = MAX_CONTEXT_ENTRIES
CONTEXT_NOTE = (
    'Discussion excerpts, authors, URLs and their commit associations were supplied by the user '
    'and are not verified. No sources were fetched. A matching displayed commit ID does not '
    'prove that a discussion concerns this repository or explains the selected code. '
    'Treat excerpts as attributed claims, not established author intent.'
)
PROVENANCE = (
    'Unverified supplied context. Authors, source labels, URLs and excerpts were provided '
    'locally; their authenticity, relevance and claims have not been verified. No discussion '
    'was fetched, and these excerpts do not establish author intent.'
)
_FIELDS = {'commit', 'source', 'url', 'author', 'excerpt'}
_FULL_COMMIT = re.compile(r'(?:[0-9a-f]{40}|[0-9a-f]{64})\Z')
_COMPONENT = re.compile(r'[A-Za-z0-9_.-]+\Z')


class ContextRecords(list[SuppliedContext]):
    """Distinguish the records envelope from entries, including an empty import."""


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


def discussion_url(value: object) -> bool:
    """Validate conservative discussion links without exposing rejected input."""
    if not isinstance(value, str) or len(value) > 2000:
        return False
    try:
        _discussion_url(value)
    except ValueError:
        return False
    return True


def validate_records(records: object, report: Report) -> list[SuppliedContext]:
    """Revalidate revision-bound records at both import and rendering boundaries."""
    if not isinstance(records, list) or len(records) > MAX_CONTEXT_RECORDS:
        raise ValueError('Context records must be a list of at most 50 excerpts.')
    displayed = {item.commit for item in [*report.blame, *report.changes, *report.renames]}
    result = []
    for index, record in enumerate(records, 1):
        data = asdict(record) if isinstance(record, SuppliedContext) else record
        if not isinstance(data, dict) or set(data) != {'commit', 'url', 'title', 'author', 'excerpt'}:
            raise ValueError(f'Context record {index} requires commit, url, title, author and excerpt.')
        commit = data['commit']
        if not isinstance(commit, str) or not _FULL_COMMIT.fullmatch(commit) or commit not in displayed:
            raise ValueError(f'Context record {index} must name an exact commit in displayed evidence.')
        if not discussion_url(data['url']):
            raise ValueError(f'Context record {index} requires a credential-free GitHub/GitLab discussion URL.')
        for field, maximum in (('title', 300), ('author', 200), ('excerpt', 4000)):
            value = _text(data[field], maximum, field, index)
            if '\r' in value:
                raise ValueError(f'Context record {index} {field} contains unsupported control characters.')
        result.append(SuppliedContext(**data))
    document = {'schema_version': 1, 'revision': report.revision,
                'records': [asdict(item) for item in result]}
    if len(json.dumps(document, ensure_ascii=False).encode('utf-8')) > MAX_CONTEXT_BYTES:
        raise ValueError('Context exceeds 256 KiB; supply fewer or shorter excerpts.')
    return result


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


def parse_context(data: bytes | str, report: Report) -> list[ContextEntry] | ContextRecords:
    """Parse bounded supplied JSON bytes/text, preserving both envelope formats."""
    check_work_budget()
    if isinstance(data, str):
        if len(data) > MAX_CONTEXT_BYTES:
            raise ValueError('Context file exceeds 256 KiB; supply fewer or shorter excerpts.')
        try:
            raw = data.encode('utf-8')
        except UnicodeError:
            raise ValueError('Context file must contain valid UTF-8 JSON with unique fields and standard values.') from None
    elif isinstance(data, bytes):
        raw = data
    else:
        raise ValueError('Context input must be UTF-8 JSON bytes or text.')
    if len(raw) > MAX_CONTEXT_BYTES:
        raise ValueError('Context file exceeds 256 KiB; supply fewer or shorter excerpts.')
    try:
        document = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique_object,
                              parse_constant=_invalid_constant)
    except (UnicodeError, ValueError, RecursionError):
        raise ValueError('Context file must contain valid UTF-8 JSON with unique fields and standard values.') from None
    if isinstance(document, dict) and ('records' in document or 'revision' in document):
        if (set(document) != {'schema_version', 'revision', 'records'}
                or type(document['schema_version']) is not int or document['schema_version'] != 1):
            raise ValueError('Context requires schema_version 1, revision and records.')
        if document['revision'] != report.revision:
            raise ValueError("Context revision must equal the report's exact resolved commit ID.")
        result = ContextRecords(validate_records(document['records'], report))
    else:
        result = _validate_document(document, report)
    check_work_budget()
    return result


def load_context(path: str | Path, report: Report) -> list[ContextEntry] | ContextRecords:
    """Read one regular file with bounded allocation, without following URLs."""
    check_work_budget()
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
        raise ValueError('Context file cannot be read; choose an existing readable regular UTF-8 JSON file.') from None
    return parse_context(raw, report)


def context_document(report: Report, entries: list[ContextEntry]) -> dict:
    """Revalidate a public rendering boundary and add explicit evidence links."""
    if (not isinstance(entries, list) or len(entries) > MAX_CONTEXT_ENTRIES
            or any(not isinstance(entry, ContextEntry) for entry in entries)):
        raise ValueError('Supplied context must contain at most 50 validated context entries.')
    valid = _validate_document({'schema_version': 1, 'entries': [asdict(item) for item in entries]}, report)
    return {'schema_version': 1, 'provenance': PROVENANCE,
            'entries': [{**asdict(item), 'evidence_anchor': commit_anchor(item.commit)} for item in valid]}
