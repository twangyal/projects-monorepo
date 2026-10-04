"""Read bounded, local Git evidence without checking out or changing a repository."""
from dataclasses import dataclass
import os
from pathlib import Path, PurePosixPath
import re
from urllib.parse import urlsplit

from .function_parser import FunctionParseError, parse_functions
from .model import (ChangeEvidence, FileCatalog, FunctionCatalog, LineEvidence,
                    RenameEvidence, Report, RevisionSnapshot, SourceFile, SourceSnapshot)
from .native_protocol import SUFFIX_LANGUAGES
from .runner import GitError, GitRunner
from .work_budget import check_work_budget


MAX_BLOB_BYTES = 512 * 1024
_RECORD = re.compile(rb'\x00([0-9a-f]{40}|[0-9a-f]{64})\x00')
_HASH = re.compile(r'[0-9a-f]{40}(?:[0-9a-f]{24})?\Z')


class ReaderError(ValueError):
    """An invalid request or unsupported committed source."""


def _decode_path(raw: str) -> str:
    """Decode Git's byte-oriented C quoting used in blame porcelain."""
    if not raw.startswith('"'):
        return raw
    if not raw.endswith('"'):
        raise ReaderError('Git returned an invalid quoted filename.')
    result = bytearray()
    value = raw[1:-1]
    index = 0
    escapes = {'a': 7, 'b': 8, 't': 9, 'n': 10, 'v': 11, 'f': 12, 'r': 13, '\\': 92, '"': 34}
    while index < len(value):
        if value[index] != '\\':
            result.extend(value[index].encode('utf-8'))
            index += 1
        elif index + 3 < len(value) and all(c in '01234567' for c in value[index + 1:index + 4]):
            result.append(int(value[index + 1:index + 4], 8))
            index += 4
        elif index + 1 < len(value) and value[index + 1] in escapes:
            result.append(escapes[value[index + 1]])
            index += 2
        else:
            raise ReaderError('Git returned an unsupported filename escape.')
    return result.decode('utf-8', errors='replace')


def _blame(raw: bytes) -> list[LineEvidence]:
    records = []
    header = None
    metadata = {}
    for line in raw.decode('utf-8', errors='replace').split('\n'):
        if line.startswith('\t'):
            if header is None or 'filename' not in metadata:
                raise ReaderError('Git returned incomplete line attribution.')
            records.append(LineEvidence(
                final_line=int(header[2]), original_line=int(header[1]), commit=header[0],
                path=_decode_path(metadata['filename']), author=metadata.get('author', ''),
                timestamp=metadata.get('author-time', ''), summary=metadata.get('summary', ''),
                content=line[1:],
            ))
            header = None
            metadata = {}
        elif header is None:
            fields = line.split(' ')
            if len(fields) in (3, 4) and _HASH.fullmatch(fields[0]):
                header = fields
        else:
            key, _, value = line.partition(' ')
            metadata[key] = value
    return records


def _records(raw: bytes):
    matches = list(_RECORD.finditer(raw))
    if raw.strip() and not matches:
        raise ReaderError('Git returned an unrecognized history format.')
    for index, match in enumerate(matches):
        stop = matches[index + 1].start() if index + 1 < len(matches) else len(raw)
        yield match[1].decode('ascii'), raw[match.end():stop]


def _restore_raw_authors(git: GitRunner, blame: list[LineEvidence]) -> None:
    # Blame automatically reads worktree/configured mailmaps. Lowercase %an in
    # pretty-format is the original commit identity, so retrieve all unique
    # identities in one bounded command instead of trusting mapped porcelain.
    commits = list(dict.fromkeys(line.commit for line in blame))
    raw = git.run('show', '--no-patch', '--no-notes', '--no-show-signature',
                  '--format=%x00%H%x00%an%x00%at%x00', *commits)
    identities = {}
    for commit, data in _records(raw):
        fields = data.split(b'\x00', 2)
        if len(fields) != 3:
            raise ReaderError('Git returned incomplete raw author metadata.')
        identities[commit] = (fields[0].decode('utf-8', errors='replace'),
                              fields[1].decode('ascii'))
    if set(identities) != set(commits):
        raise ReaderError('Git did not return all blamed commit identities.')
    for line in blame:
        line.author, line.timestamp = identities[line.commit]


def _remote(raw: bytes) -> str | None:
    """Only recognized hosts and conservative public-looking repository paths."""
    try:
        value = raw.decode('utf-8').strip()
        if value.startswith('git@') and ':' in value:
            host, path = value[4:].split(':', 1)
        else:
            parsed = urlsplit(value)
            if parsed.scheme not in ('https', 'ssh') or parsed.query or parsed.fragment:
                return None
            if parsed.password or (parsed.username is not None and not (parsed.scheme == 'ssh' and parsed.username == 'git')):
                return None
            if parsed.port is not None:
                return None
            host, path = parsed.hostname, parsed.path.lstrip('/')
        if host not in ('github.com', 'gitlab.com'):
            return None
        path = path.removesuffix('.git')
        parts = path.split('/')
        if len(parts) < 2 or (host == 'github.com' and len(parts) != 2):
            return None
        if any(not re.fullmatch(r'[A-Za-z0-9_.-]+', part) or part in ('.', '..') for part in parts):
            return None
        return f'https://{host}/{path}'
    except (UnicodeDecodeError, ValueError):
        return None


def _changes(git: GitRunner, revision: str, file: str, start: int, end: int,
             max_commits: int, warnings: list[str]) -> list[ChangeEvidence]:
    raw = git.run('--literal-pathspecs', 'log', '--no-ext-diff', '--no-textconv',
                  '--no-color', '--no-decorate', '--no-show-signature', '--no-notes', '--format=%x00%H%x00',
                  f'--max-count={max_commits + 1}', f'-L{start},{end}:{file}', revision)
    records = list(_records(raw))
    if len(records) > max_commits:
        warnings.append(f'Range history was truncated to {max_commits} commits; older changes are omitted.')
    changes = []
    for commit, patch in records[:max_commits]:
        metadata = git.run('show', '--no-patch', '--no-notes', '--no-show-signature', '--format=%an%x00%aI%x00%B', commit)
        fields = metadata.decode('utf-8', errors='replace').split('\x00', 2)
        if len(fields) != 3:
            raise ReaderError('Git returned incomplete commit metadata.')
        # Git pretty-format adds a record newline after the original message.
        message = fields[2].removesuffix('\n')
        changes.append(ChangeEvidence(commit, fields[0], fields[1], message,
                                      patch.decode('utf-8', errors='replace').lstrip('\n')))
    return changes


def _renames(git: GitRunner, revision: str, file: str, max_commits: int,
             warnings: list[str]) -> list[RenameEvidence]:
    raw = git.run('--literal-pathspecs', 'log', '--follow', '--find-renames',
                  '--no-ext-diff', '--no-textconv', '--no-color', '--no-decorate',
                  '--no-show-signature', '--no-notes', '--name-status', '-z', '--diff-filter=R', '--format=%x00%H%x00',
                  f'--max-count={max_commits + 1}', revision, '--', file)
    records = list(_records(raw))
    if len(records) > max_commits:
        warnings.append(f'Rename history was truncated to {max_commits} commits.')
    renames = []
    for commit, data in records[:max_commits]:
        fields = data.lstrip(b'\n').split(b'\x00')
        index = 0
        while index < len(fields):
            status = fields[index].lstrip(b'\n')
            if not status:
                index += 1
                continue
            if not re.fullmatch(rb'R\d{1,3}', status) or index + 2 >= len(fields):
                raise ReaderError('Git returned an unrecognized rename record.')
            renames.append(RenameEvidence(commit, fields[index + 1].decode('utf-8', errors='replace'),
                                          fields[index + 2].decode('utf-8', errors='replace'), int(status[1:])))
            index += 3
    return renames


def _require_local_objects(git: GitRunner) -> None:
    # Older supported Git versions lack GIT_NO_LAZY_FETCH. Reject promisor
    # repositories before reading any objects so missing objects cannot trigger
    # implicit network access. Read keys only: config values may hold secrets.
    keys = git.run('config', '--null', '--list', '--name-only').decode('utf-8').split('\x00')
    promisor_keys = {key for key in keys if re.fullmatch(r'remote\..*\.promisor', key)}
    if 'extensions.partialclone' in keys or len(promisor_keys) > 50:
        raise ReaderError('A complete local clone is required; partial/promisor clones may fetch missing objects.')
    for key in promisor_keys:
        if git.run('config', '--type=bool', '--get', key).strip() == b'true':
            raise ReaderError('A complete local clone is required; partial/promisor clones may fetch missing objects.')


@dataclass(frozen=True)
class _Snapshot:
    git: GitRunner
    repo_name: str
    revision: str
    source: str


def _resolve_repository(repo: str | Path, ref: str) -> tuple[GitRunner, Path, str]:
    """Resolve a complete local repository and one immutable commit."""
    if not isinstance(ref, str) or not ref or '\x00' in ref:
        raise ReaderError('Supply a nonempty Git revision without NUL characters.')
    git = GitRunner(repo)
    _require_local_objects(git)
    location_flag = ('--absolute-git-dir' if git.run('rev-parse', '--is-bare-repository').strip() == b'true'
                     else '--show-toplevel')
    repository_root = Path(os.fsdecode(git.run('rev-parse', location_flag)).removesuffix('\n'))
    git = GitRunner(repository_root)
    try:
        revision = git.run('rev-parse', '--verify', '--end-of-options', ref + '^{commit}').decode('ascii').strip()
    except GitError as exc:
        raise ReaderError('Cannot resolve the requested revision to a commit; check --repo and --ref.') from exc
    if not _HASH.fullmatch(revision):
        raise ReaderError('Git did not resolve the revision to a valid commit ID.')
    return git, repository_root, revision


def list_files(repo: str | Path, ref: str = 'HEAD', *, directory: str = '',
               language: str = 'all') -> FileCatalog:
    """Discover source candidates from tree entries and blob-size metadata."""
    check_work_budget()
    if not isinstance(directory, str) or '\x00' in directory:
        raise ReaderError('Directory must be a repository-relative path without NUL characters.')
    path = PurePosixPath(directory)
    if path.is_absolute() or '..' in path.parts or directory.startswith('\\') or re.match(r'^[A-Za-z]:[\\/]', directory):
        raise ReaderError('Directory must be repository-relative without parent traversal.')
    if not isinstance(language, str) or language not in ('all', 'python', 'javascript', 'typescript'):
        raise ReaderError('Language must be all, python, javascript or typescript.')
    directory = '' if str(path) == '.' else str(path)
    git, root, revision = _resolve_repository(repo, ref)
    args = ('--', directory + '/') if directory else ()
    raw = git.run('--literal-pathspecs', 'ls-tree', '-r', '-l', '-z', '--full-tree', revision, *args)
    files = []
    omitted = 0
    for record in raw.split(b'\x00'):
        check_work_budget()
        if not record:
            continue
        metadata, separator, name = record.partition(b'\t')
        fields = metadata.split()
        if not separator or len(fields) != 4:
            raise ReaderError('Git returned an invalid source-tree entry.')
        mode, kind, _, size = fields
        if kind != b'blob' or mode not in (b'100644', b'100755'):
            continue
        try:
            filename = name.decode('utf-8')
        except UnicodeDecodeError:
            omitted += 1
            continue
        suffix = PurePosixPath(filename).suffix
        detected = 'python' if suffix in ('.py', '.pyi') else SUFFIX_LANGUAGES.get(suffix)
        if detected == 'tsx':
            detected = 'typescript'
        if detected is None or (language != 'all' and language != detected):
            continue
        if not re.fullmatch(rb'[0-9]{1,20}', size):
            raise ReaderError('Git returned an invalid source-file size.')
        size_bytes = int(size)
        if size_bytes > MAX_BLOB_BYTES:
            continue
        if len(files) >= 10_000:
            raise ReaderError('Source catalog exceeds 10,000 files; narrow --directory or --language.')
        files.append(SourceFile(filename, detected, size_bytes))
    files.sort(key=lambda item: item.path)
    check_work_budget()
    return FileCatalog(root.name, revision, ref, directory, language, files, omitted)


def _load_snapshot(repo: str | Path, file: str, ref: str, *, missing_ok: bool = False) -> _Snapshot | None:
    """Resolve once and read bounded committed source for either selection route."""
    check_work_budget()
    if not isinstance(file, str) or not file or '\x00' in file:
        raise ReaderError('Supply a nonempty repository-relative file path without NUL characters.')
    path = PurePosixPath(file)
    if path.is_absolute() or '..' in path.parts or file.startswith('\\') or re.match(r'^[A-Za-z]:[\\/]', file):
        raise ReaderError('File must be a repository-relative path without parent traversal.')
    if missing_ok and (not path.parts or str(path) != file):
        raise ReaderError('Use the exact canonical repository-relative path, without ./, repeated or trailing slashes.')
    git, repository_root, revision = _resolve_repository(repo, ref)
    listing = git.run('--literal-pathspecs', 'ls-tree', '--full-tree', '-z', revision, '--', file)
    entry = None
    for candidate in listing.split(b'\x00'):
        if b'\t' in candidate:
            metadata, name = candidate.split(b'\t', 1)
            if name == file.encode('utf-8'):
                entry = metadata.split()
    if entry is None:
        if missing_ok:
            check_work_budget()
            return None
        raise ReaderError('File does not exist at the requested revision; use its exact repository-relative path.')
    if len(entry) != 3 or entry[1] != b'blob' or entry[0] not in (b'100644', b'100755'):
        raise ReaderError('Choose a regular committed text file, not a directory, submodule, or symbolic link.')
    blob = entry[2].decode('ascii')
    size = int(git.run('cat-file', '-s', blob).strip())
    if size > MAX_BLOB_BYTES:
        raise ReaderError('Committed source exceeds the 512 KiB file-size limit.')
    raw = git.run('cat-file', 'blob', blob, max_bytes=MAX_BLOB_BYTES)
    if b'\x00' in raw:
        raise ReaderError('Committed source contains NUL bytes and is treated as binary; choose a text file.')
    try:
        source = raw.decode('utf-8')
    except UnicodeDecodeError as exc:
        raise ReaderError('Committed source is not UTF-8 text; choose a UTF-8 file.') from exc
    check_work_budget()
    return _Snapshot(git, repository_root.name, revision, source)


def read_source(repo: str | Path, file: str, ref: str = 'HEAD') -> SourceSnapshot:
    """Read exact committed UTF-8 source without parsing or importing it."""
    snapshot = _load_snapshot(repo, file, ref)
    assert snapshot is not None
    return _source_snapshot(snapshot, file, ref)


def _source_snapshot(snapshot: _Snapshot, file: str, ref: str) -> SourceSnapshot:
    line_count = snapshot.source.count('\n') + int(bool(snapshot.source) and not snapshot.source.endswith('\n'))
    check_work_budget()
    return SourceSnapshot(snapshot.repo_name, snapshot.revision, ref, file,
                          snapshot.source, line_count)


def resolve_revision(repo: str | Path, ref: str = 'HEAD') -> RevisionSnapshot:
    """Resolve one guarded local commit without reading a source blob."""
    check_work_budget()
    _git, root, revision = _resolve_repository(repo, ref)
    check_work_budget()
    return RevisionSnapshot(root.name, revision, ref)


def read_source_or_missing(repo: str | Path, file: str, ref: str = 'HEAD') -> SourceSnapshot | None:
    """Only an exactly absent tree entry is None; every other error survives."""
    snapshot = _load_snapshot(repo, file, ref, missing_ok=True)
    return None if snapshot is None else _source_snapshot(snapshot, file, ref)


def _catalog(snapshot: _Snapshot, file: str, ref: str) -> FunctionCatalog:
    check_work_budget()
    try:
        functions = parse_functions(snapshot.source, file)
    except FunctionParseError as exc:
        raise ReaderError(str(exc)) from exc
    check_work_budget()
    return FunctionCatalog(snapshot.repo_name, snapshot.revision, ref, file, functions)


def list_functions(repo: str | Path, file: str, ref: str = 'HEAD') -> FunctionCatalog:
    """List supported committed functions without importing or executing source."""
    return _catalog(_load_snapshot(repo, file, ref), file, ref)


def inspect_repository(repo: str | Path, file: str, start: int | None = None,
                       end: int | None = None, ref: str = 'HEAD', max_commits: int = 20,
                       *, function: str | None = None) -> Report:
    """Inspect one committed range or named function from a single snapshot."""
    check_work_budget()
    if type(max_commits) is not int or not 1 <= max_commits <= 50:
        raise ReaderError('max_commits must be an integer between 1 and 50.')
    if function is not None:
        if start is not None or end is not None:
            raise ReaderError('Select exactly one function or one complete --lines range.')
        if not isinstance(function, str) or not function or '\x00' in function:
            raise ReaderError('Supply a nonempty qualified function name without NUL characters.')
    else:
        if type(start) is not int or type(end) is not int:
            raise ReaderError('Select exactly one function or one complete integer --lines range.')
        if start < 1 or end < start or end - start + 1 > 200:
            raise ReaderError('Choose an ordered, 1-based range containing at most 200 lines.')
    snapshot = _load_snapshot(repo, file, ref)
    if function is not None:
        matches = [item for item in _catalog(snapshot, file, ref).functions
                   if item.qualified_name == function]
        if not matches:
            raise ReaderError('No function has that exact qualified name; list functions to choose a name or use --lines.')
        if len(matches) > 1:
            ranges = ', '.join(f'{item.start_line}:{item.end_line}' for item in matches[:5])
            more = '; list functions to see all candidates' if len(matches) > 5 else ''
            raise ReaderError(f'Ambiguous function name: choose a manual --lines range: {ranges}{more}.')
        start, end = matches[0].start_line, matches[0].end_line
        if end - start + 1 > 200:
            raise ReaderError(f'The selected function spans {start}:{end}, exceeding 200 lines; choose a smaller manual --lines range.')
    git, revision, source = snapshot.git, snapshot.revision, snapshot.source
    # Git counts LF-delimited lines; Python splitlines also treats other controls
    # as separators and would silently assign incorrect source line numbers.
    lines = source.split('\n')
    if lines[-1] == '':
        lines.pop()
    if end > len(lines):
        raise ReaderError(f'Requested range exceeds the committed file ({len(lines)} lines).')
    selected = '\n'.join(lines[start - 1:end])
    if end < len(lines) or source.endswith('\n'):
        selected += '\n'
    check_work_budget()
    try:
        raw_blame = git.run('--literal-pathspecs', 'blame', '--root', '--line-porcelain',
                            '--no-textconv', '--ignore-revs-file', '', '-L',
                            f'{start},{end}', revision, '--', file)
    except GitError as exc:
        # Git may quote arbitrary contents of configured ignore files in stderr.
        # Keep those contents out of the public error while identifying a remedy.
        raise ReaderError(
            'Cannot attribute the requested range. Check blame.ignoreRevsFile for '
            'missing files or invalid revisions; Git command limits may also apply.'
        ) from exc
    blame = _blame(raw_blame)
    check_work_budget()
    if [line.final_line for line in blame] != list(range(start, end + 1)):
        raise ReaderError('Git returned incomplete attribution for the requested range.')
    _restore_raw_authors(git, blame)
    check_work_budget()
    report = Report(snapshot.repo_name, revision, ref, file, start, end, selected,
                    blame=blame, selected_function=function)
    report.warnings.append('Git line tracing and rename detection are heuristic; this report does not establish full semantic lineage or author intent. PR and issue discussions were not fetched.')
    try:
        if git.run('rev-parse', '--is-shallow-repository').strip() == b'true':
            report.warnings.append('This repository is shallow; history before its boundary is unavailable.')
        if git.run('rev-list', '--max-count=1', '--min-parents=2', revision).strip():
            report.warnings.append('The revision has merge ancestry; Git line tracing may omit merge changes or alternate-parent history.')
    except GitError:
        report.warnings.append('History completeness checks were unavailable; shallow or merge boundaries may be present.')
    check_work_budget()
    try:
        report.changes = _changes(git, revision, file, start, end, max_commits, report.warnings)
    except (GitError, ReaderError):
        report.warnings.append('Range-change tracing was unavailable or exceeded command limits; blame remains available and the timeline is incomplete.')
    check_work_budget()
    try:
        report.renames = _renames(git, revision, file, max_commits, report.warnings)
    except (GitError, ReaderError):
        report.warnings.append('Whole-file rename tracing was unavailable or exceeded command limits; rename evidence is incomplete.')
    check_work_budget()
    try:
        report.remote_url = _remote(git.run('config', '--get', 'remote.origin.url'))
    except GitError:
        pass
    check_work_budget()
    return report
