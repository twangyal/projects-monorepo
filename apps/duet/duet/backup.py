"""Complete offline Duet archives; pinned reads and no-clobber publication."""
from contextlib import ExitStack
import argparse
import ctypes
from dataclasses import asdict, dataclass
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import sqlite3
import stat
import sys
import tempfile
from threading import Event, current_thread, main_thread
import time

from .archive_common import (
    ArchiveError, BLOCK_BYTES, DATABASE_NAME, LOCK_NAME, MAX_ARCHIVE_BYTES,
    MAX_AUDIO_BYTES, MAX_DATABASE_BYTES, MEDIA_DIRECTORY, OPERATION_SECONDS,
    PLAYBACK_POLICY, ROOMS_MEMBER, SCHEMA_VERSION, canonical_json, check_archive,
)
from .archive_format import ArchiveSource, copy_member, read_index, read_rooms, write_archive
from .archive_media import validate_audio
from .archive_state import paused_rooms, read_library, validate_rooms, write_database


@dataclass(frozen=True)
class ArchiveSummary:
    schema_version: int
    rooms: int
    tracks: int
    memories: int
    paired_rooms: int
    pending_invites: int
    media_bytes: int
    archive_bytes: int
    playback_policy: str


def _error(code, message):
    return ArchiveError(code, message)


def _stamp(info):
    identity = (info.st_dev, info.st_ino, info.st_mode)
    return identity if stat.S_ISDIR(info.st_mode) else identity + (
        info.st_size, info.st_mtime_ns, info.st_ctime_ns)


@dataclass
class _Pin:
    fd: int
    parent: int | None
    name: str | None
    stamp: tuple

    def freeze(self):
        self.stamp = _stamp(os.fstat(self.fd))

    def check(self):
        try:
            if _stamp(os.fstat(self.fd)) != self.stamp:
                raise _error('input', 'An acquired archive input or staging file changed; preserve it and retry.')
            if self.parent is not None and _stamp(os.stat(self.name, dir_fd=self.parent,
                                                         follow_symlinks=False)) != self.stamp:
                raise _error('input', 'An acquired directory or file was replaced; preserve it and retry.')
        except OSError:
            raise _error('input', 'An acquired directory or file is no longer available; preserve it and retry.') from None


@dataclass
class _Owned:
    pin: _Pin
    directory: bool
    published: bool = False

    def cleanup(self):
        if self.published:
            return
        try:
            current = os.stat(self.pin.name, dir_fd=self.pin.parent, follow_symlinks=False)
            original = os.fstat(self.pin.fd)
            if not _same_inode(current, original):
                return
            if self.directory:
                # Never reopen the owned root through its mutable parent name.
                # Its held descriptor continues to name our original directory.
                _clear_owned_directory(self.pin.fd)
                current = os.stat(self.pin.name, dir_fd=self.pin.parent, follow_symlinks=False)
                if _same_inode(current, original):
                    os.rmdir(self.pin.name, dir_fd=self.pin.parent)
            else:
                current = os.stat(self.pin.name, dir_fd=self.pin.parent, follow_symlinks=False)
                if _same_inode(current, original):
                    os.unlink(self.pin.name, dir_fd=self.pin.parent)
        except OSError:
            pass  # Never follow or repair a rebound path during cleanup.


def _same_inode(left, right):
    return (left.st_dev, left.st_ino, left.st_mode) == (right.st_dev, right.st_ino, right.st_mode)


def _clear_owned_directory(directory, depth=0):
    if depth > 3:
        raise OSError('Unexpected staging depth')
    with os.scandir(directory) as entries:
        for count, entry in enumerate(entries):
            if count >= 64:
                raise OSError('Unexpected staging membership')
            original = os.stat(entry.name, dir_fd=directory, follow_symlinks=False)
            if stat.S_ISDIR(original.st_mode):
                child = os.open(entry.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
                                | os.O_CLOEXEC, dir_fd=directory)
                try:
                    if not _same_inode(os.fstat(child), original):
                        continue
                    _clear_owned_directory(child, depth + 1)
                    current = os.stat(entry.name, dir_fd=directory, follow_symlinks=False)
                    if _same_inode(current, original):
                        os.rmdir(entry.name, dir_fd=directory)
                finally:
                    os.close(child)
            else:
                current = os.stat(entry.name, dir_fd=directory, follow_symlinks=False)
                if _same_inode(current, original):
                    os.unlink(entry.name, dir_fd=directory)


class _Files:
    def __init__(self, stack, cancel, deadline):
        self.stack, self.cancel, self.deadline = stack, cancel, deadline
        self.pins = []

    def check(self):
        check_archive(self.cancel, self.deadline)

    def keep(self, fd, parent=None, name=None):
        self.stack.callback(os.close, fd)
        pin = _Pin(fd, parent, name, _stamp(os.fstat(fd)))
        self.pins.append(pin)
        return pin

    def directory(self, path, code='input'):
        self.check()
        path = _path(path)
        try:
            pin = self.keep(os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC))
            # Preserve '..' components: normalizing them before open could hide
            # a forbidden symlink. Every actual component is opened NOFOLLOW.
            for component in path.parts[1:]:
                self.check()
                parent = pin.fd
                fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
                             | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=parent)
                pin = self.keep(fd, parent, component)
            return pin
        except OSError:
            raise _error(code, 'An existing real directory is required; symbolic-link components are not allowed.') from None

    def file(self, parent, name, maximum, code='input', create=False):
        self.check()
        flags = os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC
        flags |= (os.O_RDWR | os.O_CREAT | os.O_EXCL) if create else os.O_RDONLY
        try:
            fd = os.open(name, flags, 0o600, dir_fd=parent)
        except OSError:
            raise _error(code, 'A required regular file is unavailable or already exists; no data was replaced.') from None
        pin = self.keep(fd, parent, name)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise _error(code, 'Archive inputs and owned outputs must be regular files, never links or special files.')
        if info.st_size > maximum:
            raise _error('limit', 'An archive input exceeds its permitted byte limit.')
        return pin

    def temporary(self, parent, *, directory=False):
        for _ in range(32):
            self.check()
            name = '.duet-restore-' if directory else '.duet-archive-'
            name += secrets.token_hex(16)
            try:
                if directory:
                    os.mkdir(name, 0o700, dir_fd=parent)
                    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
                                 | os.O_CLOEXEC, dir_fd=parent)
                else:
                    fd = os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
                                 | os.O_CLOEXEC, 0o600, dir_fd=parent)
            except FileExistsError:
                continue
            pin = self.keep(fd, parent, name)
            owned = _Owned(pin, directory)
            self.stack.callback(owned.cleanup)
            return owned
        raise _error('destination', 'Cannot allocate an exclusive private staging child; no destination was replaced.')

    def verify(self):
        self.check()
        for pin in self.pins:
            self.check()
            pin.check()


def _path(value):
    try:
        return Path(value).absolute()
    except (TypeError, ValueError, OSError):
        raise _error('input', 'Supply valid local filesystem paths.') from None


def _leaf(path):
    if path.name in ('', '.', '..'):
        raise _error('destination', 'Choose an absent named destination under an existing real parent directory.')
    return path.name


def _absent(parent, name):
    try:
        os.stat(name, dir_fd=parent, follow_symlinks=False)
    except FileNotFoundError:
        return
    raise _error('destination', 'The destination already exists; choose a new absent destination. Nothing was replaced.')


def _inside(child, root):
    return child == root or root in child.parents


def _outside(source, output):
    try:
        lexical_source = Path(os.path.abspath(source))
        lexical_output = Path(os.path.abspath(output))
        if _inside(lexical_output, lexical_source) or _inside(output.resolve(strict=False), source.resolve(strict=True)):
            raise _error('destination', 'Create the archive outside the complete source library, under an existing parent.')
    except OSError:
        raise _error('destination', 'The archive output ancestry cannot be verified.') from None


def _check_ancestry(parent, source, files):
    target = os.fstat(source)
    current = os.dup(parent)
    try:
        for _ in range(4096):
            files.check()
            info = os.fstat(current)
            if (info.st_dev, info.st_ino) == (target.st_dev, target.st_ino):
                raise _error('destination', 'Create the archive outside the complete source library.')
            higher = os.open('..', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                             dir_fd=current)
            above = os.fstat(higher)
            os.close(current)
            current = higher
            if (above.st_dev, above.st_ino) == (info.st_dev, info.st_ino):
                return
        raise _error('destination', 'The archive output ancestry exceeds its safe traversal limit.')
    finally:
        os.close(current)


def _sidecars(directory):
    result = {}
    for suffix in ('-wal', '-journal', '-shm'):
        try:
            info = os.stat(DATABASE_NAME + suffix, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            continue
        if not stat.S_ISREG(info.st_mode) or (suffix != '-shm' and info.st_size):
            raise _error('input', 'Database sidecars require a clean shutdown and checkpoint; preserve them before retrying.')
        result[suffix] = _stamp(info)
    return result


def _names(directory, maximum, files):
    result = set()
    with os.scandir(directory) as entries:
        for entry in entries:
            files.check()
            if len(result) >= maximum:
                raise _error('input', 'Source media has unexpected entries; preserve and clean up the library before retrying.')
            result.add(entry.name)
    return result


def _media_tree(files, source, records):
    try:
        fd = os.open(MEDIA_DIRECTORY, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
                     | os.O_CLOEXEC, dir_fd=source)
    except OSError:
        raise _error('input', 'The source media directory must exist and contain only its referenced tracks.') from None
    media = files.keep(fd, source, MEDIA_DIRECTORY)
    room_names = _names(media.fd, 5, files)
    expected_rooms = set(records.room_ids)
    if not room_names <= expected_rooms:
        raise _error('input', 'Source media has an unreferenced room directory; preserve it and recover the library.')
    rooms = {}
    expected_tracks = {room: set() for room in records.room_ids}
    for track in records.tracks:
        expected_tracks[track.room_id].add(track.track_id + '.ogg')
    for room in records.room_ids:
        if room not in room_names:
            if expected_tracks[room]:
                raise _error('input', 'Source media is missing referenced tracks; preserve and recover the library.')
            continue
        try:
            fd = os.open(room, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                         dir_fd=media.fd)
        except OSError:
            raise _error('input', 'Referenced media room entries must be real directories.') from None
        pin = files.keep(fd, media.fd, room)
        names = _names(pin.fd, 12, files)
        if names != expected_tracks[room]:
            raise _error('input', 'Source media contains missing or unreferenced files; preserve and recover the library.')
        rooms[room] = pin
    return media, room_names, rooms, expected_tracks


def _check_media_tree(files, media, names, rooms, expected):
    if _names(media.fd, 5, files) != names:
        raise _error('input', 'The source media directory changed before publication.')
    for room, pin in rooms.items():
        if _names(pin.fd, 12, files) != expected[room]:
            raise _error('input', 'Source media entries changed before publication.')


def _hash(pin, files):
    size = os.fstat(pin.fd).st_size
    digest = hashlib.sha256()
    offset = 0
    while offset < size:
        files.check()
        chunk = os.pread(pin.fd, min(BLOCK_BYTES, size - offset), offset)
        if not chunk:
            raise _error('input', 'A source media file changed during its bounded read.')
        digest.update(chunk)
        offset += len(chunk)
    pin.check()
    return digest.hexdigest()


def _summary(records, media_bytes, archive_bytes):
    return ArchiveSummary(records.schema_version, len(records.room_ids), len(records.tracks),
                          records.memory_count, records.paired_rooms, records.pending_invites,
                          media_bytes, archive_bytes, PLAYBACK_POLICY)


def _relationship(index, records):
    if index.schema_version != records.schema_version:
        raise _error('metadata', 'Archive manifest and room record versions do not match.')
    expected = (ROOMS_MEMBER,) + tuple(f'media/{track.room_id}/{track.track_id}.ogg' for track in records.tracks)
    if tuple(member.name for member in index.members) != expected:
        raise _error('metadata', 'Archive media members do not match all active room tracks.')
    return sum(member.size for member in index.members if member.name != ROOMS_MEMBER)


def _archive_input(files, path):
    path = _path(path)
    parent = files.directory(path.parent)
    return files.file(parent.fd, _leaf(path), MAX_ARCHIVE_BYTES)


def _read_records(files, archive):
    index = read_index(archive.fd, cancel=files.cancel, deadline=files.deadline)
    files.check()
    raw = read_rooms(archive.fd, index, cancel=files.cancel, deadline=files.deadline)
    records = validate_rooms(raw, cancel=files.cancel, deadline=files.deadline)
    return index, records, _relationship(index, records)


def _platform(*, restore=False):
    if sys.platform != 'linux' or not Path('/proc/self/fd').is_dir() or not shutil.rmtree.avoids_symlink_attacks:
        raise _error('input', 'Offline library archives require Linux descriptor paths and safe directory cleanup.')
    if restore:
        try:
            with sqlite3.connect(':memory:') as database:
                database.execute('CREATE TABLE rooms (id TEXT PRIMARY KEY, document TEXT NOT NULL)')
                database.serialize()
        except (AttributeError, sqlite3.Error):
            raise _error('storage', 'This Python SQLite runtime cannot serialize a trusted restore database.') from None
        _rename_supported()


def _rename_supported():
    try:
        function = ctypes.CDLL(None, use_errno=True).renameat2
    except AttributeError:
        raise _error('destination', 'Atomic no-replace restoration is unavailable on this Linux runtime.') from None
    function.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    function.restype = ctypes.c_int
    if function(-1, b'probe', -1, b'probe', 1) != -1 or ctypes.get_errno() not in (errno.EBADF, errno.ENOENT):
        raise _error('destination', 'Atomic no-replace restoration is unavailable on this Linux runtime.')
    return function


def _rename_noreplace(parent, source, destination):
    function = _rename_supported()
    if function(parent, os.fsencode(source), parent, os.fsencode(destination), 1):
        if ctypes.get_errno() in (errno.EEXIST, errno.ENOTEMPTY):
            raise _error('destination', 'The restore destination appeared before publication; nothing was replaced.')
        raise _error('storage', 'The complete restore could not be published; the existing destination was preserved.')


def _operation(callback, *paths, cancel=None, restore=False):
    if cancel is None:
        cancel = Event()
    if not isinstance(cancel, Event):
        raise _error('input', 'Cancellation must be a threading Event.')
    deadline = time.monotonic() + OPERATION_SECONDS
    try:
        check_archive(cancel, deadline)
        _platform(restore=restore)
        with ExitStack() as stack:
            return callback(_Files(stack, cancel, deadline), *paths)
    except ArchiveError:
        raise
    except Exception:
        raise _error('storage', 'The archive operation failed safely; preserve the original library and archive before retrying.') from None


def _create(files, data_dir, output):
    data_dir, output = _path(data_dir), _path(output)
    source = files.directory(data_dir)
    lock = files.file(source.fd, LOCK_NAME, MAX_DATABASE_BYTES)
    try:
        fcntl.flock(lock.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        raise _error('busy', 'The library is in use. Stop Duet cleanly before creating its archive.') from None
    files.stack.callback(fcntl.flock, lock.fd, fcntl.LOCK_UN)
    sidecars = _sidecars(source.fd)
    database = files.file(source.fd, DATABASE_NAME, MAX_DATABASE_BYTES)
    records = read_library(database.fd, cancel=files.cancel, deadline=files.deadline)
    files.check()
    _outside(data_dir, output)
    parent = files.directory(output.parent, 'destination')
    name = _leaf(output)
    _check_ancestry(parent.fd, source.fd, files)
    _absent(parent.fd, name)
    media, room_names, rooms, expected = _media_tree(files, source.fd, records)
    sources = []
    for track in records.tracks:
        pin = files.file(rooms[track.room_id].fd, track.track_id + '.ogg', MAX_AUDIO_BYTES)
        digest = _hash(pin, files)
        validate_audio(pin.fd, track.duration, cancel=files.cancel, deadline=files.deadline)
        pin.check()
        sources.append(ArchiveSource(f'media/{track.room_id}/{track.track_id}.ogg', pin.fd,
                                     os.fstat(pin.fd).st_size, digest))
    owned = files.temporary(parent.fd)
    write_archive(owned.pin.fd, time.time() * 1000, records.rooms_json, tuple(sources),
                  cancel=files.cancel, deadline=files.deadline)
    os.fsync(owned.pin.fd)
    owned.pin.freeze()
    archive_bytes = os.fstat(owned.pin.fd).st_size
    summary = _summary(records, sum(item.size for item in sources), archive_bytes)
    _check_media_tree(files, media, room_names, rooms, expected)
    if _sidecars(source.fd) != sidecars:
        raise _error('input', 'Database sidecars changed; stop and checkpoint Duet cleanly before retrying.')
    _outside(data_dir, output)
    _check_ancestry(parent.fd, source.fd, files)
    files.verify()
    _absent(parent.fd, name)
    files.check()
    try:
        # Link the original open inode, not an attacker-replaced temporary name.
        os.link(f'/proc/self/fd/{owned.pin.fd}', name, dst_dir_fd=parent.fd, follow_symlinks=True)
    except FileExistsError:
        raise _error('destination', 'The archive destination appeared before publication; nothing was replaced.') from None
    try:
        os.fsync(parent.fd)
    except OSError:
        raise _error('storage', 'The COMPLETE archive was published, but directory durability is unconfirmed. Preserve the published archive.') from None
    return summary


def create_archive(data_dir: Path, output: Path, *, cancel: Event | None = None) -> ArchiveSummary:
    return _operation(_create, data_dir, output, cancel=cancel)


def _inspect(files, path):
    archive = _archive_input(files, path)
    index, records, media_bytes = _read_records(files, archive)
    parent = files.directory(tempfile.gettempdir())
    stage = files.temporary(parent.fd, directory=True)
    for track in records.tracks:
        with ExitStack() as stack:
            scratch = _Files(stack, files.cancel, files.deadline)
            owned = scratch.temporary(stage.pin.fd)
            copy_member(archive.fd, index, f'media/{track.room_id}/{track.track_id}.ogg', owned.pin.fd,
                        cancel=files.cancel, deadline=files.deadline)
            owned.pin.freeze()
            validate_audio(owned.pin.fd, track.duration, cancel=files.cancel, deadline=files.deadline)
            scratch.verify()
    files.verify()
    return _summary(records, media_bytes, os.fstat(archive.fd).st_size)


def inspect_archive(archive: Path, *, cancel: Event | None = None) -> ArchiveSummary:
    return _operation(_inspect, archive, cancel=cancel)


def _restore(files, path, data_dir):
    archive = _archive_input(files, path)
    target = _path(data_dir)
    parent = files.directory(target.parent, 'destination')
    name = _leaf(target)
    _absent(parent.fd, name)
    index, records, media_bytes = _read_records(files, archive)
    restored_at = time.time() * 1000
    paused = paused_rooms(records, restored_at, cancel=files.cancel, deadline=files.deadline)
    stage = files.temporary(parent.fd, directory=True)
    os.mkdir(MEDIA_DIRECTORY, 0o700, dir_fd=stage.pin.fd)
    media = files.keep(os.open(MEDIA_DIRECTORY, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
                              | os.O_CLOEXEC, dir_fd=stage.pin.fd), stage.pin.fd, MEDIA_DIRECTORY)
    rooms = {}
    for track in records.tracks:
        if track.room_id not in rooms:
            os.mkdir(track.room_id, 0o700, dir_fd=media.fd)
            rooms[track.room_id] = files.keep(os.open(track.room_id, os.O_RDONLY | os.O_DIRECTORY
                                                    | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=media.fd),
                                             media.fd, track.room_id)
        output = files.file(rooms[track.room_id].fd, track.track_id + '.ogg', MAX_AUDIO_BYTES, create=True)
        copy_member(archive.fd, index, f'media/{track.room_id}/{track.track_id}.ogg', output.fd,
                    cancel=files.cancel, deadline=files.deadline)
        output.freeze()
        validate_audio(output.fd, track.duration, cancel=files.cancel, deadline=files.deadline)
        output.check()
        os.fsync(output.fd)
    write_database(stage.pin.fd, paused, cancel=files.cancel, deadline=files.deadline)
    database = files.file(stage.pin.fd, DATABASE_NAME, MAX_DATABASE_BYTES)
    checked = read_library(database.fd, cancel=files.cancel, deadline=files.deadline)
    # read_library emits the current envelope without promoting room objects;
    # an old input retains version1 for its summary and paused records. Compare
    # the same complete room values under the current verification envelope.
    expected = json.loads(paused)
    expected['schemaVersion'] = SCHEMA_VERSION
    if checked.rooms_json != canonical_json(expected):
        raise _error('metadata', 'The trusted restored database does not match the admitted private records.')
    os.fsync(database.fd)
    for room in rooms.values():
        os.fsync(room.fd)
    os.fsync(media.fd)
    os.fsync(stage.pin.fd)
    files.verify()
    _absent(parent.fd, name)
    summary = _summary(records, media_bytes, os.fstat(archive.fd).st_size)
    files.check()
    _rename_noreplace(parent.fd, stage.pin.name, name)
    stage.published = True
    # After rename, only parent fsync and descriptor closure are permitted.
    # Cancellation arriving now is completion, never removal of the target.
    try:
        os.fsync(parent.fd)
    except OSError:
        raise _error('storage', 'The COMPLETE restored library was published, but directory durability is unconfirmed. Preserve the published library.') from None
    return summary


def restore_archive(archive: Path, data_dir: Path, *, cancel: Event | None = None) -> ArchiveSummary:
    return _operation(_restore, archive, data_dir, cancel=cancel, restore=True)


class _PrivateParser(argparse.ArgumentParser):
    def error(self, _message):
        self.print_usage(sys.stderr)
        self.exit(2, 'Invalid archive command arguments. Use --help for the required options.\n')


def main(argv: list[str] | None = None) -> int:
    parser = _PrivateParser(description='Complete offline Duet library archives; keep private links separately.')
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('create')
    create.add_argument('--data-dir', type=Path, required=True)
    create.add_argument('--output', type=Path, required=True)
    inspect = commands.add_parser('inspect')
    inspect.add_argument('--archive', type=Path, required=True)
    restore = commands.add_parser('restore')
    restore.add_argument('--archive', type=Path, required=True)
    restore.add_argument('--data-dir', type=Path, required=True)
    try:
        args = parser.parse_args(argv)
    except SystemExit as error:
        return int(error.code)
    cancel = Event()
    previous = {}

    def interrupt(_signum, _frame):
        cancel.set()

    if current_thread() is main_thread():
        for name in (signal.SIGINT, signal.SIGTERM):
            previous[name] = signal.signal(name, interrupt)
    try:
        if args.command == 'create':
            summary = create_archive(args.data_dir, args.output, cancel=cancel)
        elif args.command == 'inspect':
            summary = inspect_archive(args.archive, cancel=cancel)
        else:
            summary = restore_archive(args.archive, args.data_dir, cancel=cancel)
        print(canonical_json(asdict(summary)).decode('utf-8'))
        print('Keep both participants\' private access links separately; this archive does not recover lost credentials.')
        return 0
    except ArchiveError as error:
        print(str(error), file=sys.stderr)
        return 130 if error.code == 'cancelled' else 2
    except KeyboardInterrupt:
        print('Archive operation cancelled; no incomplete destination was published.', file=sys.stderr)
        return 130
    except Exception:
        print('The offline archive operation failed. Preserve the original library and archive before retrying.', file=sys.stderr)
        return 2
    finally:
        for name, handler in previous.items():
            signal.signal(name, handler)


if __name__ == '__main__':
    raise SystemExit(main())
