"""Bounded metadata-only discovery between two immutable Git trees."""
from dataclasses import dataclass, fields
import json
from pathlib import Path, PurePosixPath
import re

from .reader import ReaderError, _resolve_repository
from .runner import GitError
from .work_budget import check_work_budget, current_work_budget, work_budget

MAX_CHANGED_PATHS = 10_000
MAX_PATH_BYTES = 4096
MAX_REF_BYTES = 1024
MAX_CATALOG_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class ChangedEndpoint:
    kind: str
    mode: str
    object_id: str


@dataclass(frozen=True)
class ChangedPath:
    path: str
    change: str
    left: ChangedEndpoint | None
    right: ChangedEndpoint | None
    addressable: bool


@dataclass(frozen=True)
class ChangedFileCatalog:
    schema_version: int
    kind: str
    repo_name: str
    left_requested_ref: str
    left_revision: str
    right_requested_ref: str
    right_revision: str
    directory: str
    entries: tuple[ChangedPath, ...]
    omitted_non_utf8_paths: int


_OID = re.compile(r'(?:[0-9a-f]{40}|[0-9a-f]{64})\Z')
_MODES = {'100644': 'regular', '100755': 'regular', '120000': 'symlink', '160000': 'gitlink'}


def _text(value, maximum: int, label: str, *, empty: bool = False) -> str:
    if type(value) is not str or (not value and not empty) or '\0' in value or len(value) > maximum:
        raise ReaderError(f'Invalid bounded {label}.')
    try:
        if len(value.encode('utf-8')) > maximum:
            raise ReaderError(f'Invalid bounded {label}.')
    except UnicodeError:
        raise ReaderError(f'{label.capitalize()} must be valid UTF-8.') from None
    return value


def _addressable(path: str) -> bool:
    parsed = PurePosixPath(path)
    return bool(parsed.parts and not parsed.is_absolute() and '..' not in parsed.parts
                and not path.startswith('\\') and not re.match(r'^[A-Za-z]:[\\/]', path)
                and str(parsed) == path)


def _directory(value) -> str:
    _text(value, MAX_PATH_BYTES, 'directory', empty=True)
    if value and not _addressable(value):
        raise ReaderError('Use an exact canonical repository-relative directory.')
    return value


def _path(value) -> str:
    _text(value, MAX_PATH_BYTES, 'changed path')
    # Git tree paths themselves are canonical even when the source API refuses
    # their leading backslash or drive-like spelling. Preserve those literally.
    if value.startswith('/') or any(part in ('', '.', '..') for part in value.split('/')):
        raise ReaderError('Invalid committed tree path.')
    return value


def _record(value, cls) -> dict:
    keys = {field.name for field in fields(cls)}
    if type(value) is cls:
        data = vars(value)
    elif type(value) is dict:
        data = value
    else:
        raise ReaderError('Use exact changed-file records and primitive fields.')
    if set(data) != keys:
        raise ReaderError('Unexpected or missing changed-file fields.')
    return data


def _oid(value, width: int | None = None) -> str:
    if (type(value) is not str or not _OID.fullmatch(value) or set(value) == {'0'}
            or (width is not None and len(value) != width)):
        raise ReaderError('Expected a complete nonzero object ID of the repository object format.')
    return value


def _endpoint(value, width: int) -> ChangedEndpoint | None:
    if value is None:
        return None
    data = _record(value, ChangedEndpoint)
    mode = data['mode']
    if type(mode) is not str or mode not in _MODES or type(data['kind']) is not str or data['kind'] != _MODES[mode]:
        raise ReaderError('Invalid changed-file entry mode or kind.')
    result = ChangedEndpoint(data['kind'], mode, _oid(data['object_id'], width))
    return value if type(value) is ChangedEndpoint else result


def _change(left: ChangedEndpoint | None, right: ChangedEndpoint | None) -> str:
    if left is None and right is not None:
        return 'added'
    if right is None and left is not None:
        return 'deleted'
    if left is None or right is None or left == right:
        raise ReaderError('A changed path must contain an actual changed endpoint.')
    if left.kind != right.kind:
        return 'type-changed'
    if left.object_id == right.object_id:
        return 'mode-changed'
    return 'modified'


def _wire(catalog: ChangedFileCatalog) -> dict:
    def side(value):
        return vars(value).copy() if value is not None else None
    return {**vars(catalog), 'entries': [
        {**vars(entry), 'left': side(entry.left), 'right': side(entry.right)}
        for entry in catalog.entries
    ]}


def _serialize(catalog: ChangedFileCatalog) -> str:
    # Incremental encoding bounds escaped output before building one large string.
    chunks = []
    size = 1  # final LF
    for chunk in json.JSONEncoder(ensure_ascii=False, sort_keys=True, indent=2).iterencode(_wire(catalog)):
        check_work_budget()
        size += len(chunk.encode('utf-8'))
        if size > MAX_CATALOG_BYTES:
            raise ReaderError('Changed-file JSON exceeds 8 MiB; narrow the directory.')
        chunks.append(chunk)
    return ''.join(chunks) + '\n'


def validate_changed_files(catalog: ChangedFileCatalog | dict) -> ChangedFileCatalog:
    """Validate exact bounded metadata; this does not attest external provenance."""
    check_work_budget()
    data = _record(catalog, ChangedFileCatalog)
    if type(data['schema_version']) is not int or data['schema_version'] != 1:
        raise ReaderError('Changed-file schema version must be 1.')
    if type(data['kind']) is not str or data['kind'] != 'changed-file-catalog':
        raise ReaderError('Expected a changed-file-catalog.')
    _text(data['repo_name'], MAX_PATH_BYTES, 'repository name')
    for key in ('left_requested_ref', 'right_requested_ref'):
        _text(data[key], MAX_REF_BYTES, 'revision label')
    width = len(_oid(data['left_revision']))
    _oid(data['right_revision'], width)
    directory = _directory(data['directory'])
    entries, omitted = data['entries'], data['omitted_non_utf8_paths']
    if (type(entries) not in (tuple, list) or len(entries) > MAX_CHANGED_PATHS
            or (type(catalog) is ChangedFileCatalog and type(entries) is not tuple)
            or type(omitted) is not int or not 0 <= omitted <= MAX_CHANGED_PATHS - len(entries)):
        raise ReaderError('Changed-file catalog exceeds 10,000 paths or has invalid counts.')
    result = []
    previous = None
    for entry in entries:
        check_work_budget()
        row = _record(entry, ChangedPath)
        if type(catalog) is ChangedFileCatalog and type(entry) is not ChangedPath:
            raise ReaderError('Immutable catalogs require immutable changed-path records.')
        if type(entry) is ChangedPath and any(
                value is not None and type(value) is not ChangedEndpoint
                for value in (row['left'], row['right'])):
            raise ReaderError('Immutable paths require immutable endpoint records.')
        path = _path(row['path'])
        encoded = path.encode('utf-8')
        if previous is not None and encoded <= previous:
            raise ReaderError('Changed paths must be unique and sorted by UTF-8 bytes.')
        previous = encoded
        if directory and not path.startswith(directory + '/'):
            raise ReaderError('Changed path is outside the selected directory.')
        left, right = _endpoint(row['left'], width), _endpoint(row['right'], width)
        if type(row['change']) is not str or row['change'] != _change(left, right):
            raise ReaderError('Changed-file category does not match its endpoints.')
        if type(row['addressable']) is not bool or row['addressable'] != _addressable(path):
            raise ReaderError('Changed-file addressability does not match the exact path policy.')
        result.append(ChangedPath(path, row['change'], left, right, row['addressable']))
    if data['left_revision'] == data['right_revision'] and (result or omitted):
        raise ReaderError('Identical tree revisions cannot have changed paths.')
    validated = ChangedFileCatalog(**{**data, 'entries': tuple(result)})
    _serialize(validated)
    check_work_budget()
    return catalog if type(catalog) is ChangedFileCatalog else validated


def render_changed_files_json(catalog: ChangedFileCatalog | dict) -> str:
    """Canonical CLI/browser JSON, including a final LF and bounded UTF-8 bytes."""
    return _serialize(validate_changed_files(catalog))


def _parse_raw(raw: bytes, oid_width: int, directory: str) -> tuple[tuple[ChangedPath, ...], int]:
    if type(raw) is not bytes or len(raw) > 2 * 1024 * 1024 or oid_width not in (40, 64):
        raise ReaderError('Invalid or oversized raw changed-file output; narrow the directory.')
    if not raw:
        return (), 0
    parts = raw.split(b'\0')
    if parts[-1] != b'' or (len(parts) - 1) % 2:
        raise ReaderError('Git returned invalid NUL-delimited changed-file framing.')
    count = (len(parts) - 1) // 2
    if count > MAX_CHANGED_PATHS:
        raise ReaderError('Changed-file catalog exceeds 10,000 paths; narrow the directory.')
    rows = []
    omitted = 0
    seen = set()
    zero = '0' * oid_width
    for index in range(0, len(parts) - 1, 2):
        check_work_budget()
        metadata, name = parts[index:index + 2]
        if not name or len(name) > MAX_PATH_BYTES or name in seen:
            raise ReaderError('Invalid, duplicate or oversized changed path; narrow the directory.')
        seen.add(name)
        if directory and not name.startswith(directory.encode('utf-8') + b'/'):
            raise ReaderError('Git returned a path outside the selected directory.')
        try:
            fields_ = metadata.decode('ascii').split(' ')
        except UnicodeError:
            raise ReaderError('Git returned invalid raw changed-file metadata.') from None
        if len(fields_) != 5 or not fields_[0].startswith(':'):
            raise ReaderError('Git returned invalid raw changed-file metadata.')
        old_mode, new_mode, old_oid, new_oid, status = fields_
        old_mode = old_mode[1:]
        def side(mode, object_id):
            if mode == '000000':
                if object_id != zero:
                    raise ReaderError('Absent raw endpoint must have a zero object ID.')
                return None
            return _endpoint({'kind': _MODES.get(mode), 'mode': mode, 'object_id': object_id}, oid_width)
        left, right = side(old_mode, old_oid), side(new_mode, new_oid)
        change = _change(left, right)
        expected = {'added': 'A', 'deleted': 'D', 'type-changed': 'T',
                    'modified': 'M', 'mode-changed': 'M'}[change]
        if status != expected:
            raise ReaderError('Git raw status disagrees with changed endpoints.')
        try:
            path = name.decode('utf-8')
        except UnicodeDecodeError:
            # Still validate framing/endpoint metadata/counts for omitted paths.
            if name.startswith(b'/') or any(part in (b'', b'.', b'..') for part in name.split(b'/')):
                raise ReaderError('Invalid committed tree path.')
            omitted += 1
            continue
        _path(path)
        rows.append(ChangedPath(path, change, left, right, _addressable(path)))
    check_work_budget()
    rows.sort(key=lambda row: row.path.encode('utf-8'))
    return tuple(rows), omitted


def list_changed_files(repo: str | Path, left_ref: str = 'HEAD~1', right_ref: str = 'HEAD',
                       *, directory: str = '') -> ChangedFileCatalog:
    """Read only committed tree metadata, within the existing aggregate budget."""
    # Direct library and CLI calls get the same aggregate bound as workbench;
    # an enclosing caller's cancellation/deadline is never reset or replaced.
    if current_work_budget() is None:
        with work_budget():
            return list_changed_files(repo, left_ref, right_ref, directory=directory)
    check_work_budget()
    _text(left_ref, MAX_REF_BYTES, 'left revision')
    _text(right_ref, MAX_REF_BYTES, 'right revision')
    directory = _directory(directory)
    git, root, left = _resolve_repository(repo, left_ref)
    try:
        right = git.run('rev-parse', '--verify', '--end-of-options', right_ref + '^{commit}').decode('ascii').strip()
    except (GitError, UnicodeError) as exc:
        raise ReaderError('Cannot resolve the requested right revision to a commit.') from exc
    _oid(left)
    _oid(right, len(left))
    args = (directory + '/',) if directory else ()
    raw = git.run('--literal-pathspecs', 'diff-tree', '--no-commit-id', '-r', '--raw', '-z',
                  '--no-abbrev', '--no-renames', '--no-ext-diff', '--no-textconv',
                  '--ignore-submodules=none', left, right, '--', *args)
    entries, omitted = _parse_raw(raw, len(left), directory)
    return validate_changed_files(ChangedFileCatalog(
        1, 'changed-file-catalog', root.name, left_ref, left, right_ref, right, directory,
        entries, omitted,
    ))
