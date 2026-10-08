"""Immutable, explicitly selected committed source comparison."""
from array import array
from dataclasses import dataclass, fields
import hashlib
from pathlib import Path, PurePosixPath
import re

from .reader import ReaderError, list_functions, read_source_or_missing, resolve_revision
from .work_budget import check_work_budget

MAX_COMPARE_LINES = 200
MAX_COMPARE_BYTES = 512 * 1024
MAX_ALIGNMENT_CELLS = 40_000
_REVISION = re.compile(r'(?:[0-9a-f]{40}|[0-9a-f]{64})\Z')


@dataclass(frozen=True)
class CompareSelection:
    kind: str
    start: int | None = None
    end: int | None = None
    function: str | None = None


@dataclass(frozen=True)
class CompareTarget:
    ref: str
    path: str
    selection: CompareSelection


@dataclass(frozen=True)
class ComparisonSide:
    requested_ref: str
    revision: str
    path: str
    status: str
    selection: CompareSelection
    start_line: int | None
    end_line: int | None
    selected_function: str | None
    source: str
    source_sha256: str | None


@dataclass(frozen=True)
class ComparisonBlock:
    kind: str
    left_start: int
    left_end: int
    right_start: int
    right_end: int


@dataclass(frozen=True)
class ComparisonReport:
    schema_version: int
    kind: str
    repo_name: str
    left: ComparisonSide
    right: ComparisonSide
    blocks: tuple[ComparisonBlock, ...]
    unchanged_lines: int
    removed_lines: int
    added_lines: int


def compare_repository(repo: str | Path, left: CompareTarget,
                       right: CompareTarget) -> ComparisonReport:
    """Resolve both requests first, then select only those immutable objects."""
    check_work_budget()
    _target(left)
    _target(right)
    left_pin = resolve_revision(repo, left.ref)
    right_pin = resolve_revision(repo, right.ref)
    left_side = _select(repo, left, left_pin.revision)
    right_side = _select(repo, right, right_pin.revision)
    if left_side.status == right_side.status == 'missing':
        raise ReaderError('At least one comparison side must be present.')
    blocks, unchanged, removed, added = _align(_tokens(left_side.source), _tokens(right_side.source))
    check_work_budget()
    return ComparisonReport(1, 'source-comparison', left_pin.repo_name, left_side,
                            right_side, blocks, unchanged, removed, added)


def validate_comparison(report: ComparisonReport) -> ComparisonReport:
    """Admit exact immutable fields and independently recheck canonical alignment."""
    check_work_budget()
    _record(report, ComparisonReport)
    if type(report.schema_version) is not int or report.schema_version != 1:
        raise ValueError('Comparison schema version must be 1.')
    if type(report.kind) is not str or report.kind != 'source-comparison':
        raise ValueError('Expected a source-comparison report.')
    _text(report.repo_name, 4096, 'repository name')
    left = _side(report.left)
    right = _side(report.right)
    if report.left.status == report.right.status == 'missing':
        raise ValueError('At least one comparison side must be present.')
    if type(report.blocks) is not tuple or len(report.blocks) > 2 * MAX_COMPARE_LINES:
        raise ValueError('Comparison blocks must be a bounded immutable tuple.')
    for block in report.blocks:
        check_work_budget()
        _record(block, ComparisonBlock)
        if type(block.kind) is not str or block.kind not in ('equal', 'change'):
            raise ValueError('Invalid comparison block kind.')
        for offset in (block.left_start, block.left_end, block.right_start, block.right_end):
            _integer(offset, 0, MAX_COMPARE_LINES, 'block offset')
    for count in (report.unchanged_lines, report.removed_lines, report.added_lines):
        _integer(count, 0, MAX_COMPARE_LINES, 'line count')
    blocks, unchanged, removed, added = _align(left, right)
    if (report.blocks != blocks or report.unchanged_lines != unchanged
            or report.removed_lines != removed or report.added_lines != added):
        raise ValueError('Comparison blocks and counts must match the canonical exact-text alignment.')
    check_work_budget()
    return report


def _record(value, cls):
    if type(value) is not cls or set(vars(value)) != {field.name for field in fields(cls)}:
        raise ValueError('Use exact immutable comparison dataclasses and fields.')


def _text(value, maximum: int, label: str, *, empty: bool = False):
    if (type(value) is not str or (not value and not empty) or '\0' in value
            or len(value) > maximum):
        raise ValueError(f'Invalid bounded {label}.')
    try:
        if len(value.encode('utf-8')) > maximum:
            raise ValueError(f'Invalid bounded {label}.')
    except UnicodeError:
        raise ValueError(f'{label.capitalize()} must be valid UTF-8.') from None


def _integer(value, low: int, high: int, label: str):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f'Invalid {label}.')


def _path(value):
    _text(value, 4096, 'repository-relative path')
    path = PurePosixPath(value)
    if (path.is_absolute() or '..' in path.parts or value.startswith('\\')
            or re.match(r'^[A-Za-z]:[\\/]', value)):
        raise ValueError('Path must be repository-relative without parent traversal.')
    if not path.parts or str(path) != value:
        raise ReaderError('Use the exact canonical repository-relative path, without ./, repeated or trailing slashes.')


def _selection(value):
    _record(value, CompareSelection)
    if type(value.kind) is not str:
        raise ValueError('Invalid comparison selection kind.')
    if value.kind in ('whole', 'missing'):
        if value.start is not None or value.end is not None or value.function is not None:
            raise ValueError('Whole and missing selections have no range or function.')
    elif value.kind == 'lines':
        _integer(value.start, 1, 2 ** 31 - 1, 'start line')
        _integer(value.end, value.start, 2 ** 31 - 1, 'end line')
        if value.function is not None or value.end - value.start + 1 > MAX_COMPARE_LINES:
            raise ValueError('Select an ordered range containing at most 200 lines and no function.')
    elif value.kind == 'function':
        if value.start is not None or value.end is not None:
            raise ValueError('Function selections have no manual range.')
        _text(value.function, 8192, 'qualified function name')
    else:
        raise ValueError('Select whole, lines, function or verified missing.')


def _target(value):
    _record(value, CompareTarget)
    _text(value.ref, 1024, 'revision request')
    _path(value.path)
    _selection(value.selection)


def _tokens(source: str) -> tuple[str, ...]:
    # A trailing LF belongs to its line, never to an extra empty token.
    if not source:
        return ()
    parts = source.split('\n')
    return tuple(part + '\n' for part in parts[:-1]) + ((parts[-1],) if parts[-1] else ())


def _select(repo, target: CompareTarget, revision: str) -> ComparisonSide:
    check_work_budget()
    snapshot = read_source_or_missing(repo, target.path, revision)
    selection = target.selection
    if selection.kind == 'missing':
        if snapshot is not None:
            raise ReaderError('The missing selection requires a verified absent path, not an existing file.')
        return ComparisonSide(target.ref, revision, target.path, 'missing', selection,
                              None, None, None, '', None)
    if snapshot is None:
        raise ReaderError('The selected path is absent; choose Missing or another exact path.')
    check_work_budget()
    tokens = _tokens(snapshot.source)
    start, end = None, None
    function = None
    if selection.kind == 'whole':
        if tokens:
            start, end = 1, len(tokens)
    elif selection.kind == 'lines':
        start, end = selection.start, selection.end
        if end > len(tokens):
            raise ReaderError('Requested range exceeds the committed file.')
    else:
        catalog = list_functions(repo, target.path, ref=revision)
        matches = [item for item in catalog.functions if item.qualified_name == selection.function]
        if not matches:
            raise ReaderError('No function has that exact name; list functions or choose manual lines.')
        if len(matches) != 1:
            raise ReaderError('Ambiguous function name; choose an explicit manual range.')
        start, end = matches[0].start_line, matches[0].end_line
        function = selection.function
    if start is not None and end - start + 1 > MAX_COMPARE_LINES:
        raise ReaderError('Comparison selection exceeds 200 lines; choose a smaller range or function.')
    selected = ''.join(tokens[start - 1:end]) if start is not None else ''
    check_work_budget()
    return ComparisonSide(target.ref, revision, target.path, 'present', selection,
                          start, end, function, selected,
                          hashlib.sha256(selected.encode('utf-8')).hexdigest())


def _side(value: ComparisonSide) -> tuple[str, ...]:
    _record(value, ComparisonSide)
    _text(value.requested_ref, 1024, 'revision request')
    _text(value.revision, 64, 'immutable revision')
    if not _REVISION.fullmatch(value.revision):
        raise ValueError('Comparison revisions must be full lowercase commit IDs.')
    _path(value.path)
    _selection(value.selection)
    _text(value.source, MAX_COMPARE_BYTES, 'selected source', empty=True)
    if type(value.status) is not str or value.status not in ('present', 'missing'):
        raise ValueError('Invalid comparison side status.')
    if value.status == 'missing':
        if (value.selection.kind != 'missing' or value.source != ''
                or value.start_line is not None or value.end_line is not None
                or value.selected_function is not None or value.source_sha256 is not None):
            raise ValueError('Missing sides must have empty text and no source provenance.')
        return ()
    if value.selection.kind == 'missing':
        raise ValueError('Present sides cannot have a missing selection.')
    tokens = _tokens(value.source)
    if len(tokens) > MAX_COMPARE_LINES:
        raise ValueError('Comparison source exceeds 200 lines.')
    if type(value.source_sha256) is not str or value.source_sha256 != hashlib.sha256(value.source.encode('utf-8')).hexdigest():
        raise ValueError('Comparison source hash does not match its exact UTF-8 text.')
    if not tokens:
        if value.selection.kind != 'whole' or value.start_line is not None or value.end_line is not None:
            raise ValueError('Only an empty whole file can have no line bounds.')
    else:
        _integer(value.start_line, 1, 2 ** 31 - 1, 'source start line')
        _integer(value.end_line, value.start_line, 2 ** 31 - 1, 'source end line')
        if value.end_line - value.start_line + 1 != len(tokens):
            raise ValueError('Source line bounds must match the selected physical lines.')
        if value.selection.kind == 'whole' and value.start_line != 1:
            raise ValueError('Whole-file source must begin at line 1.')
        if value.selection.kind == 'lines' and (value.start_line != value.selection.start or value.end_line != value.selection.end):
            raise ValueError('Manual selection and source line bounds must match.')
    if value.selection.kind == 'function':
        if type(value.selected_function) is not str or value.selected_function != value.selection.function:
            raise ValueError('Selected function provenance must match the request.')
    elif value.selected_function is not None:
        raise ValueError('Only function selections may have selected-function provenance.')
    check_work_budget()
    return tokens


def _align(left: tuple[str, ...], right: tuple[str, ...]):
    check_work_budget()
    n, m = len(left), len(right)
    if n > MAX_COMPARE_LINES or m > MAX_COMPARE_LINES or n * m > MAX_ALIGNMENT_CELLS:
        raise ValueError('Comparison alignment exceeds its 200-line bound.')
    # Dictionary equality confirms complete strings even when hashes collide.
    identities = {}
    sequences = []
    for tokens in (left, right):
        sequence = []
        for token in tokens:
            check_work_budget()
            sequence.append(identities.setdefault(token, len(identities)))
        sequences.append(sequence)
    a, b = sequences
    check_work_budget()
    width = m + 1
    table = array('H', [0]) * ((n + 1) * width)
    for i in range(n - 1, -1, -1):
        if i % 32 == 0:
            check_work_budget()
        row = i * width
        next_row = row + width
        for j in range(m - 1, -1, -1):
            table[row + j] = (1 + table[next_row + j + 1] if a[i] == b[j]
                              else max(table[next_row + j], table[row + j + 1]))
    check_work_budget()
    i = j = unchanged = 0
    blocks = []
    while i < n or j < m:
        check_work_budget()
        left_start, right_start = i, j
        equal = i < n and j < m and a[i] == b[j]
        if equal:
            while i < n and j < m and a[i] == b[j]:
                check_work_budget()
                i += 1
                j += 1
                unchanged += 1
        else:
            while i < n or j < m:
                check_work_budget()
                if i < n and j < m and a[i] == b[j]:
                    break
                if j == m or (i < n and table[(i + 1) * width + j] >= table[i * width + j + 1]):
                    i += 1
                else:
                    j += 1
        blocks.append(ComparisonBlock('equal' if equal else 'change', left_start, i, right_start, j))
    check_work_budget()
    return tuple(blocks), unchanged, n - unchanged, m - unchanged
