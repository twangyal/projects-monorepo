"""Complete offline Friendly archives; private, pinned and never overwriting."""
from contextlib import ExitStack, closing
import argparse
import ctypes
from dataclasses import asdict, dataclass
import errno
import fcntl
import hashlib
import os
from pathlib import Path
import secrets
import signal
import sqlite3
import stat
import sys
import tempfile
from threading import Event, current_thread, main_thread
import time

from .archive_common import (
    ARCHIVE_VERSION, ArchiveError, ArchiveSource, ArchiveSummary, BLOCK_BYTES,
    DATABASE_NAME, ImageFile, LOCK_NAME, MAX_ARCHIVE_BYTES, MAX_DATABASE_BYTES,
    MAX_IMAGE_BYTES, OPERATION_SECONDS, canonical_json, check_archive,
)
from .archive_format import copy_member, read_index, read_records, write_archive
from .archive_media import validate_image
from .archive_state import copy_library_image, read_library, validate_records, write_database


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
            if _same_inode(current, original):
                # Flat stage children have their own earlier cleanup callbacks.
                # Never reopen or recursively clear a mutable stage pathname.
                if self.directory:
                    os.rmdir(self.pin.name, dir_fd=self.pin.parent)
                else:
                    os.unlink(self.pin.name, dir_fd=self.pin.parent)
        except OSError:
            pass


def _same_inode(left, right):
    return (left.st_dev, left.st_ino, left.st_mode) == (right.st_dev, right.st_ino, right.st_mode)


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
        if create:
            self.stack.callback(_Owned(pin, False).cleanup)
        return pin

    def temporary(self, parent, *, directory=False):
        for _ in range(32):
            self.check()
            name = '.friendly-stage-' if directory else '.friendly-file-'
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
    for suffix in ('-wal', '-shm', '-journal'):
        try:
            info = os.stat(DATABASE_NAME + suffix, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            continue
        if not stat.S_ISREG(info.st_mode) or info.st_size:
            raise _error('input', 'Database sidecars require a clean shutdown and checkpoint; preserve them before retrying.')
        result[suffix] = _stamp(info)
    return result


def _names(directory, files):
    names = set()
    with os.scandir(directory) as entries:
        for entry in entries:
            files.check()
            if len(names) >= 5:
                raise _error('input', 'Source children are unexpected; preserve and clean up the library before retrying.')
            names.add(entry.name)
    return names


def _source_children(source, files):
    sidecars = _sidecars(source)
    expected = {DATABASE_NAME, LOCK_NAME} | {DATABASE_NAME + suffix for suffix in sidecars}
    if _names(source, files) != expected:
        raise _error('input', 'Source children are unexpected; preserve and clean up the library before retrying.')
    return sidecars


def _hash(pin, files):
    size = os.fstat(pin.fd).st_size
    digest = hashlib.sha256()
    offset = 0
    while offset < size:
        files.check()
        chunk = os.pread(pin.fd, min(BLOCK_BYTES, size - offset), offset)
        if not chunk:
            raise _error('input', 'An acquired input changed during its bounded read.')
        digest.update(chunk)
        offset += len(chunk)
    pin.check()
    return digest.hexdigest()


def _summary(records, media_bytes, archive_bytes):
    return ArchiveSummary(ARCHIVE_VERSION, records.source_schema_version, len(records.records),
                          records.evidence_count, len(records.images), records.claimed_seats,
                          records.pending_invites, media_bytes, archive_bytes)


def _image_name(image):
    return f'images/{image.challenge_id}/{image.evidence_id}.jpg'


def _relationship(index, records):
    expected = tuple(f'records/{record.challenge_id}.json' for record in records.records)
    expected += tuple(_image_name(image) for image in records.images)
    if tuple(member.name for member in index.members) != expected:
        raise _error('metadata', 'Archive members do not match every retained record and image.')
    members = {member.name: member for member in index.members}
    for image in records.images:
        member = members[_image_name(image)]
        if (member.size, member.sha256) != (image.size, image.sha256):
            raise _error('metadata', 'Archive images do not match their retained descriptors.')
    return sum(image.size for image in records.images)


def _archive_input(files, path):
    path = _path(path)
    parent = files.directory(path.parent)
    return files.file(parent.fd, _leaf(path), MAX_ARCHIVE_BYTES)


def _read_records(files, archive):
    index = read_index(archive.fd, cancel=files.cancel, deadline=files.deadline)
    files.check()
    raw = read_records(archive.fd, index, cancel=files.cancel, deadline=files.deadline)
    records = validate_records(raw, index.source_schema_version,
                               cancel=files.cancel, deadline=files.deadline)
    files.check()
    return index, records, _relationship(index, records)


def _rename_supported():
    try:
        function = ctypes.CDLL(None, use_errno=True).renameat2
    except (AttributeError, OSError):
        raise _error('destination', 'Atomic no-replace restore is unavailable on this Linux runtime.') from None
    function.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    function.restype = ctypes.c_int
    if function(-1, b'probe', -1, b'probe', 1) != -1 or ctypes.get_errno() not in (errno.EBADF, errno.ENOENT):
        raise _error('destination', 'Atomic no-replace restore is unavailable on this Linux runtime.')
    return function


def _rename_noreplace(parent, source, destination):
    function = _rename_supported()
    if function(parent, os.fsencode(source), parent, os.fsencode(destination), 1):
        if ctypes.get_errno() in (errno.EEXIST, errno.ENOTEMPTY):
            raise _error('destination', 'The restore destination appeared before publication; nothing was replaced.')
        raise _error('storage', 'The complete restore could not be published; the destination was preserved.')


def _platform(restore=False):
    if sys.platform != 'linux' or not Path('/proc/self/fd').is_dir():
        raise _error('input', 'Offline library archives require Linux descriptor-path support.')
    if restore:
        _rename_supported()
        try:
            with closing(sqlite3.connect(':memory:')) as database:
                database.execute('CREATE TABLE probe (id INTEGER)')
                database.serialize()
        except (AttributeError, sqlite3.Error):
            raise _error('storage', 'This Python SQLite runtime cannot serialize a trusted restore database.') from None


def _operation(callback, *paths, cancel=None, restore=False):
    cancel = Event() if cancel is None else cancel
    if not isinstance(cancel, Event):
        raise _error('input', 'Cancellation must be a threading Event.')
    deadline = time.monotonic() + OPERATION_SECONDS
    try:
        check_archive(cancel, deadline)
        _platform(restore)
        with ExitStack() as stack:
            return callback(_Files(stack, cancel, deadline), *paths)
    except ArchiveError:
        raise
    except Exception:
        raise _error('storage', 'The archive operation failed safely; preserve the original library and archive before retrying.') from None


def _create(files, data_dir, output):
    data_dir, output = _path(data_dir), _path(output)
    _outside(data_dir, output)
    source = files.directory(data_dir)
    lock = files.file(source.fd, LOCK_NAME, MAX_DATABASE_BYTES)
    try:
        fcntl.flock(lock.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        raise _error('busy', 'The library is in use. Stop Friendly Challenges cleanly before creating an archive.') from None
    files.stack.callback(fcntl.flock, lock.fd, fcntl.LOCK_UN)
    sidecars = _source_children(source.fd, files)
    database = files.file(source.fd, DATABASE_NAME, MAX_DATABASE_BYTES)
    original_hash = _hash(database, files)
    records = read_library(database.fd, cancel=files.cancel, deadline=files.deadline)
    files.check()
    parent = files.directory(output.parent, 'destination')
    name = _leaf(output)
    _check_ancestry(parent.fd, source.fd, files)
    _absent(parent.fd, name)
    stage = files.temporary(parent.fd, directory=True)
    media = []
    for image in records.images:
        image_file = files.file(stage.pin.fd, image.challenge_id + '-' + image.evidence_id + '.jpg', MAX_IMAGE_BYTES, create=True)
        copy_library_image(database.fd, image, image_file.fd,
                           cancel=files.cancel, deadline=files.deadline)
        image_file.freeze()
        validate_image(image_file.fd, image, cancel=files.cancel, deadline=files.deadline)
        image_file.check()
        media.append(ArchiveSource(_image_name(image), image_file.fd, image.size, image.sha256))
    owned = files.temporary(parent.fd)
    write_archive(owned.pin.fd, int(time.time() * 1000), records.source_schema_version,
                  records.records, tuple(media), cancel=files.cancel, deadline=files.deadline)
    os.fsync(owned.pin.fd)
    owned.pin.freeze()
    summary = _summary(records, sum(image.size for image in records.images),
                       os.fstat(owned.pin.fd).st_size)
    if _source_children(source.fd, files) != sidecars or _hash(database, files) != original_hash:
        raise _error('input', 'Source database or sidecars changed; stop the service cleanly before retrying.')
    _outside(data_dir, output)
    _check_ancestry(parent.fd, source.fd, files)
    files.verify()
    _absent(parent.fd, name)
    files.check()
    try:
        # Publish the acquired inode, not a possibly replaced temporary name.
        os.link(f'/proc/self/fd/{owned.pin.fd}', name, dst_dir_fd=parent.fd, follow_symlinks=True)
    except FileExistsError:
        raise _error('destination', 'The archive destination appeared before publication; nothing was replaced.') from None
    owned.cleanup()
    # Publication is completion. No later cancellation/deadline can roll it back.
    try:
        os.fsync(parent.fd)
    except OSError:
        raise _error('storage', 'The COMPLETE archive was published, but directory durability is unconfirmed. Preserve it.') from None
    return summary


def create_archive(data_dir: Path, output: Path, *, cancel: Event | None = None) -> ArchiveSummary:
    return _operation(_create, data_dir, output, cancel=cancel)


def _inspect(files, path):
    archive = _archive_input(files, path)
    index, records, media_bytes = _read_records(files, archive)
    parent = files.directory(tempfile.gettempdir())
    stage = files.temporary(parent.fd, directory=True)
    for image in records.images:
        with ExitStack() as stack:
            scratch = _Files(stack, files.cancel, files.deadline)
            output = scratch.temporary(stage.pin.fd)
            copy_member(archive.fd, index, _image_name(image), output.pin.fd,
                        cancel=files.cancel, deadline=files.deadline)
            output.pin.freeze()
            validate_image(output.pin.fd, image, cancel=files.cancel, deadline=files.deadline)
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
    stage = files.temporary(parent.fd, directory=True)
    images, owned_images = [], []
    for image in records.images:
        output = files.file(stage.pin.fd, image.challenge_id + '-' + image.evidence_id + '.jpg', MAX_IMAGE_BYTES, create=True)
        copy_member(archive.fd, index, _image_name(image), output.fd,
                    cancel=files.cancel, deadline=files.deadline)
        output.freeze()
        validate_image(output.fd, image, cancel=files.cancel, deadline=files.deadline)
        output.check()
        images.append(ImageFile(image, output.fd))
        owned_images.append(_Owned(output, False))
    write_database(stage.pin.fd, records, tuple(images), cancel=files.cancel, deadline=files.deadline)
    database = files.file(stage.pin.fd, DATABASE_NAME, MAX_DATABASE_BYTES)
    owned_database = _Owned(database, False)
    files.stack.callback(owned_database.cleanup)
    # No external content enters through an imported SQLite pathname.
    checked = read_library(database.fd, cancel=files.cancel, deadline=files.deadline)
    if (checked.records, checked.images, checked.evidence_count, checked.claimed_seats, checked.pending_invites) != (records.records, records.images, records.evidence_count, records.claimed_seats, records.pending_invites):
        raise _error('metadata', 'The trusted restored database does not match the admitted records.')
    for image in records.images:
        with ExitStack() as stack:
            scratch = _Files(stack, files.cancel, files.deadline)
            output = scratch.temporary(stage.pin.fd)
            copy_library_image(database.fd, image, output.pin.fd,
                               cancel=files.cancel, deadline=files.deadline)
            output.pin.freeze()
            validate_image(output.pin.fd, image, cancel=files.cancel, deadline=files.deadline)
            scratch.verify()
    os.fsync(database.fd)
    files.verify()
    # Remove acquired private payload scratch before publishing only trusted DB.
    for owned in owned_images:
        owned.cleanup()
        files.pins.remove(owned.pin)
    if set(os.listdir(stage.pin.fd)) != {DATABASE_NAME}:
        raise _error('storage', 'Owned restore staging is incomplete; no destination was published.')
    os.fsync(stage.pin.fd)
    summary = _summary(records, media_bytes, os.fstat(archive.fd).st_size)
    os.fsync(parent.fd)
    files.verify()
    _absent(parent.fd, name)
    files.check()
    _rename_noreplace(parent.fd, stage.pin.name, name)
    stage.published = True
    # Stop registered database cleanup from unlinking the now published graph.
    owned_database.published = True
    try:
        os.fsync(parent.fd)
    except OSError:
        raise _error('storage', 'The COMPLETE restored library was published, but directory durability is unconfirmed. Preserve it.') from None
    return summary


def restore_archive(archive: Path, data_dir: Path, *, cancel: Event | None = None) -> ArchiveSummary:
    return _operation(_restore, archive, data_dir, cancel=cancel, restore=True)


class _PrivateParser(argparse.ArgumentParser):
    def error(self, _message):
        self.print_usage(sys.stderr)
        self.exit(2, 'Invalid archive arguments. Use --help for the required options.\n')


def main(argv: list[str] | None = None) -> int:
    parser = _PrivateParser(description='Complete offline private library archives; retain original links separately.')
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
    cancel, previous = Event(), {}

    def interrupt(_signum, _frame):
        cancel.set()

    if current_thread() is main_thread():
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous[signum] = signal.signal(signum, interrupt)
    try:
        if args.command == 'create':
            summary = create_archive(args.data_dir, args.output, cancel=cancel)
        elif args.command == 'inspect':
            summary = inspect_archive(args.archive, cancel=cancel)
        else:
            summary = restore_archive(args.archive, args.data_dir, cancel=cancel)
        print(canonical_json(asdict(summary)).decode('utf-8'))
        print('Keep original private access and invitation links separately; this archive does not recover lost credentials.')
        return 0
    except ArchiveError as error:
        print(str(error), file=sys.stderr)
        return 130 if error.code == 'cancelled' else 2
    except KeyboardInterrupt:
        print('Archive operation cancelled; preserve the original library and archive.', file=sys.stderr)
        return 130
    except Exception:
        print('The offline archive failed safely; preserve the original library and archive.', file=sys.stderr)
        return 2
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


if __name__ == '__main__':
    raise SystemExit(main())
