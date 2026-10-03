"""Bounded offline imports of explicitly unverified discussion excerpts."""

from dataclasses import asdict
import json
import os
from pathlib import Path
import re
import stat
from urllib.parse import urlsplit

from .model import Report, SuppliedContext

MAX_CONTEXT_BYTES = 256 * 1024
MAX_CONTEXT_RECORDS = 50
CONTEXT_NOTE = (
    "Discussion excerpts, authors, URLs and their commit associations were supplied by the user "
    "and are not verified. No sources were fetched. A matching displayed commit ID does not "
    "prove that a discussion concerns this repository or explains the selected code. "
    "Treat excerpts as attributed claims, not established author intent."
)
_HASH = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")
_PART = r"[A-Za-z0-9_.-]+"


def discussion_url(value: str) -> bool:
    """Allow conservative source links, without credentials, queries or escapes."""
    if (not isinstance(value, str) or len(value) > 2000
            or any(ord(c) <= 32 or ord(c) >= 127 for c in value)):
        return False
    try:
        parsed = urlsplit(value)
        if (parsed.scheme != "https" or parsed.netloc not in {"github.com", "gitlab.com"}
                or parsed.query or "?" in value or "%" in value):
            return False
        parts = parsed.path.split("/")[1:]
        if any(part in {".", ".."} for part in parts):
            return False
        if parsed.netloc == "github.com":
            path_pattern = rf"/{_PART}/{_PART}/(?:pull|issues|discussions)/[1-9][0-9]*"
            fragment_pattern = r"(?:issuecomment-[0-9]+|discussioncomment-[0-9]+|discussion_r[0-9]+)"
        else:
            path_pattern = rf"/(?:{_PART}/){{2,}}-/(?:merge_requests|issues)/[1-9][0-9]*"
            fragment_pattern = r"note_[0-9]+"
        return bool(re.fullmatch(path_pattern, parsed.path) and (
            not parsed.fragment or re.fullmatch(fragment_pattern, parsed.fragment)
        ))
    except ValueError:
        return False


def _text(value: object, maximum: int) -> bool:
    return (isinstance(value, str) and bool(value.strip()) and len(value) <= maximum
            and not any((ord(c) < 32 and c not in "\n\t") or ord(c) == 127
                        or 0xD800 <= ord(c) <= 0xDFFF for c in value))


def validate_records(records: object, report: Report) -> list[SuppliedContext]:
    """Validate at import and rendering boundaries, never quoting invalid input."""
    if not isinstance(records, list) or len(records) > MAX_CONTEXT_RECORDS:
        raise ValueError("Context records must be a list of at most 50 excerpts.")
    displayed = {item.commit for item in [*report.blame, *report.changes, *report.renames]}
    result = []
    for index, record in enumerate(records, 1):
        data = asdict(record) if isinstance(record, SuppliedContext) else record
        if not isinstance(data, dict) or set(data) != {"commit", "url", "title", "author", "excerpt"}:
            raise ValueError(f"Context record {index} requires commit, url, title, author and excerpt.")
        commit = data["commit"]
        if not isinstance(commit, str) or not _HASH.fullmatch(commit) or commit not in displayed:
            raise ValueError(f"Context record {index} must name an exact commit in displayed evidence.")
        if not discussion_url(data["url"]):
            raise ValueError(f"Context record {index} requires a credential-free GitHub/GitLab discussion URL.")
        if not all(_text(data[key], maximum) for key, maximum in (
            ("title", 300), ("author", 200), ("excerpt", 4000)
        )):
            raise ValueError(f"Context record {index} has invalid or oversized title, author or excerpt text.")
        result.append(SuppliedContext(**data))
    return result


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Context JSON contains duplicate object keys.")
        result[key] = value
    return result


def load_context(path: str | Path, report: Report) -> list[SuppliedContext]:
    """Read a regular local JSON file with a byte cap before parsing anything."""
    # Nonblocking open ensures named pipes cannot stall the command. fstat
    # checks the opened file rather than a racy pre-open path inspection.
    descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError("Context input must be a regular local JSON file.")
        if metadata.st_size > MAX_CONTEXT_BYTES:
            raise ValueError("Context input exceeds 256 KiB.")
        with os.fdopen(descriptor, "rb", closefd=False) as handle:
            raw = handle.read(MAX_CONTEXT_BYTES + 1)
    finally:
        os.close(descriptor)
    if len(raw) > MAX_CONTEXT_BYTES:
        raise ValueError("Context input exceeds 256 KiB.")
    try:
        data = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError("Context input must be valid UTF-8 JSON with bounded nesting.") from error
    if (not isinstance(data, dict) or set(data) != {"schema_version", "revision", "records"}
            or type(data["schema_version"]) is not int or data["schema_version"] != 1):
        raise ValueError("Context requires schema_version 1, revision and records.")
    if data["revision"] != report.revision:
        raise ValueError("Context revision must equal the report's exact resolved commit ID.")
    return validate_records(data["records"], report)
