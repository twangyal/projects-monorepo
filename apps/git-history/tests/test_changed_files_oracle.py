"""Original tree/byte oracle; expected identities never come from the catalog."""

from dataclasses import asdict, replace
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from threading import Event
import unittest
from unittest.mock import patch

from git_history.changed_files import (
    ChangedEndpoint, ChangedFileCatalog, ChangedPath,
    list_changed_files, render_changed_files_json, validate_changed_files,
)
from git_history.reader import ReaderError
from git_history.runner import GitRunner
from git_history.work_budget import WorkCancelled, work_budget


def blob_id(content):
    return hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()


class OriginalTrees:
    """Build literal committed trees with a private index, including raw path bytes."""

    def __init__(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='git123-oracle-')
        self.path = Path(self.temporary.name)
        self.env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
                        GIT_AUTHOR_NAME='Original fixture',
                        GIT_AUTHOR_EMAIL='oracle@example.invalid',
                        GIT_COMMITTER_NAME='Original fixture',
                        GIT_COMMITTER_EMAIL='oracle@example.invalid',
                        GIT_AUTHOR_DATE='2001-02-03T04:05:06+00:00',
                        GIT_COMMITTER_DATE='2001-02-03T04:05:06+00:00')
        self.git('init', '-q', '--initial-branch=main')
        self.index = self.path / 'oracle.index'

    def git(self, *args, data=None, private_index=False):
        env = dict(self.env)
        if private_index:
            env['GIT_INDEX_FILE'] = str(self.index)
        return subprocess.check_output(['git', '-C', str(self.path), *args],
                                       input=data, env=env, stderr=subprocess.PIPE)

    def tree(self, entries, *, parent=None, message='Original literal tree'):
        self.git('read-tree', '--empty', private_index=True)
        records = bytearray()
        identities = {}
        for path, (mode, content) in entries.items():
            if mode == '160000':
                oid = content
            else:
                oid = blob_id(content)
                actual = self.git('hash-object', '-w', '--stdin', data=content).decode().strip()
                if actual != oid:
                    raise AssertionError('Independent blob header hash differs from Git')
            identities[path] = (mode, oid)
            records.extend(mode.encode() + b' ' + oid.encode() + b'\t' + path + b'\0')
        if records:
            self.git('update-index', '-z', '--index-info', data=bytes(records), private_index=True)
        tree = self.git('write-tree', private_index=True).decode().strip()
        args = ['commit-tree', tree]
        if parent:
            args += ['-p', parent]
        commit = self.git(*args, data=(message + '\n').encode()).decode().strip()
        return commit, identities

    def close(self):
        self.temporary.cleanup()


def endpoint(mode, content):
    kind = {'100644': 'regular', '100755': 'regular',
            '120000': 'symlink', '160000': 'gitlink'}[mode]
    return ChangedEndpoint(kind, mode, content if mode == '160000' else blob_id(content))


class ChangedFilesOracleTests(unittest.TestCase):
    def setUp(self):
        self.repo = OriginalTrees()
        self.addCleanup(self.repo.close)
        self.left, _ = self.repo.tree({b'base.txt': ('100644', b'left\n')})
        self.right, _ = self.repo.tree({b'base.txt': ('100644', b'right\n')}, parent=self.left)
        self.repo.git('update-ref', 'refs/heads/main', self.right)

    def catalog(self, **kwargs):
        return list_changed_files(self.repo.path, self.left, self.right, **kwargs)

    def injected_raw(self, raw, **kwargs):
        original = GitRunner.run

        def controlled(runner, *args, **options):
            if 'diff-tree' in args:
                return raw
            return original(runner, *args, **options)

        with patch.object(GitRunner, 'run', controlled):
            return self.catalog(**kwargs)

    def raw_added(self, path=b'new.txt'):
        return b':000000 100644 ' + b'0' * 40 + b' ' + blob_id(b'').encode() + b' A\0' + path + b'\0'

    def test_literal_all_entry_types_content_modes_and_rename(self):
        old = {
            b'unchanged': ('100644', b'same'), b'modified': ('100644', b'old\n'),
            b'deleted': ('100644', b'gone'), b'mode': ('100644', b'#!/bin/sh\n'),
            b'content-mode': ('100644', b'old'), b'regular-to-link': ('100644', b'target'),
            b'link-to-regular': ('120000', b'old-target'), b'link': ('120000', b'a'),
            b'gitlink': ('160000', self.left), b'regular-to-gitlink': ('100644', b'file'),
            b'gitlink-to-regular': ('160000', self.left), b'former-dir/child': ('100644', b'leaf'),
            b'rename-before': ('100644', b'identical rename bytes'),
        }
        new = {
            b'unchanged': old[b'unchanged'], b'modified': ('100644', b'new\n'),
            b'added-empty': ('100644', b''), b'mode': ('100755', b'#!/bin/sh\n'),
            b'content-mode': ('100755', b'new'), b'regular-to-link': ('120000', b'target'),
            b'link-to-regular': ('100644', b'new-file'), b'link': ('120000', b'b'),
            b'gitlink': ('160000', self.right), b'regular-to-gitlink': ('160000', self.right),
            b'gitlink-to-regular': ('100644', b'file'), b'former-dir': ('100644', b'now file'),
            b'rename-after': old[b'rename-before'], b'binary': ('100644', b'\0\xff\x01'),
            b'invalid-content': ('100644', b'\xff\xfe'),
        }
        changes = {
            'added-empty': 'added', 'binary': 'added', 'content-mode': 'modified',
            'deleted': 'deleted', 'former-dir': 'added', 'former-dir/child': 'deleted',
            'gitlink': 'modified', 'gitlink-to-regular': 'type-changed',
            'invalid-content': 'added', 'link': 'modified', 'link-to-regular': 'type-changed',
            'mode': 'mode-changed', 'modified': 'modified', 'regular-to-gitlink': 'type-changed',
            'regular-to-link': 'type-changed', 'rename-after': 'added', 'rename-before': 'deleted',
        }
        # Freeze literal expectations before invoking the producer.
        expected = tuple(ChangedPath(path, change,
                                    endpoint(*old[path.encode()]) if path.encode() in old else None,
                                    endpoint(*new[path.encode()]) if path.encode() in new else None,
                                    True) for path, change in sorted(changes.items()))
        self.left, _ = self.repo.tree(old)
        self.right, _ = self.repo.tree(new, parent=self.left)
        calls = []
        original = GitRunner.run

        def observed(runner, *args, **options):
            calls.append(args)
            return original(runner, *args, **options)

        with patch.object(GitRunner, 'run', observed):
            result = self.catalog()
        self.assertEqual(result.entries, expected)
        self.assertEqual(result.omitted_non_utf8_paths, 0)
        self.assertFalse(any('cat-file' in args and 'blob' in args for args in calls))
        self.assertIs(validate_changed_files(result), result)

    def test_literal_paths_utf8_byte_sort_and_nonutf8_omissions(self):
        paths = [b' space.py', b'-option.py', b'C:/drive.py', b'\\root.py', b'glob[1]*?.py',
                 b'line\nname.py', b'tab\tname.py', 'é.py'.encode(), '中.py'.encode(),
                 b'invalid-\xff.py', b'invalid-\xfe.py']
        expected = tuple(ChangedPath(path.decode(), 'added', None, endpoint('100644', b'literal'),
                                    path not in (b'C:/drive.py', b'\\root.py'))
                         for path in sorted(paths) if not path.startswith(b'invalid-'))
        self.left, _ = self.repo.tree({})
        self.right, _ = self.repo.tree(dict.fromkeys(paths, ('100644', b'literal')), parent=self.left)
        result = self.catalog()
        self.assertEqual(result.entries, expected)
        self.assertEqual(result.omitted_non_utf8_paths, 2)
        self.assertNotIn('\ufffd', render_changed_files_json(result))

    def test_literal_directory_boundary_and_glob_directory(self):
        self.left, _ = self.repo.tree({})
        self.right, _ = self.repo.tree({path: ('100644', b'x') for path in
                                       [b'src/a', b'src/sub/b', b'src-extra/c',
                                        b'src[one]/d', b'srco/d']}, parent=self.left)
        self.assertEqual([row.path for row in self.catalog(directory='src').entries],
                         ['src/a', 'src/sub/b'])
        result = self.catalog(directory='src[one]')
        self.assertEqual([row.path for row in result.entries], ['src[one]/d'])
        self.assertEqual(result.directory, 'src[one]')

    def test_reject_noncanonical_directory_and_primitive_inputs(self):
        for value in ['.', './src', 'src/', 'src//sub', '../src', '/src', 'C:/src', '\\src',
                      'src\0x', 'x' * 4097, None, False]:
            with self.subTest(directory=repr(value)), self.assertRaises(ReaderError):
                self.catalog(directory=value)
        for value in ['', 'x' * 1025, '\ud800', None, False]:
            with self.subTest(ref=repr(value)), self.assertRaises(ReaderError):
                list_changed_files(self.repo.path, value, self.right)

    def test_empty_same_revision_and_missing_revision_is_not_empty(self):
        result = list_changed_files(self.repo.path, self.left, self.left)
        self.assertEqual(result.entries, ())
        self.assertEqual(result.omitted_non_utf8_paths, 0)
        with self.assertRaises((ReaderError, RuntimeError)):
            list_changed_files(self.repo.path, self.left, 'does-not-exist')

    def test_requested_labels_retained_and_both_refs_pinned_before_diff(self):
        self.repo.git('update-ref', 'refs/heads/left-label', self.left)
        self.repo.git('update-ref', 'refs/heads/right-label', self.right)
        later, _ = self.repo.tree({b'base.txt': ('100644', b'future')}, parent=self.right)
        original = GitRunner.run
        diff_calls = []

        def moved(runner, *args, **options):
            if 'diff-tree' in args:
                self.repo.git('update-ref', 'refs/heads/right-label', later)
                diff_calls.append(args)
            return original(runner, *args, **options)

        with patch.object(GitRunner, 'run', moved):
            result = list_changed_files(self.repo.path, 'left-label', 'right-label')
        self.assertEqual((result.left_revision, result.right_revision), (self.left, self.right))
        self.assertEqual((result.left_requested_ref, result.right_requested_ref),
                         ('left-label', 'right-label'))
        self.assertEqual(result.entries[0].right.object_id, blob_id(b'right\n'))
        self.assertEqual(len(diff_calls), 1)
        self.assertIn(self.left, diff_calls[0])
        self.assertIn(self.right, diff_calls[0])
        self.assertNotIn('right-label', diff_calls[0])

    def test_dirty_index_worktree_and_untracked_bytes_unchanged(self):
        self.repo.git('reset', '--hard', self.right)
        (self.repo.path / 'base.txt').write_bytes(b'staged, not committed')
        self.repo.git('add', 'base.txt')
        (self.repo.path / 'base.txt').write_bytes(b'working tree, not staged')
        (self.repo.path / 'untracked').write_bytes(b'original untracked\0\xff')
        paths = [self.repo.path / '.git/index', self.repo.path / '.git/HEAD',
                 self.repo.path / 'base.txt', self.repo.path / 'untracked']
        before = [path.read_bytes() for path in paths]
        result = self.catalog()
        self.assertEqual(result.entries[0].right.object_id, blob_id(b'right\n'))
        self.assertEqual([path.read_bytes() for path in paths], before)

    def test_hostile_diff_config_and_attributes_do_not_execute_helpers(self):
        marker = self.repo.path / 'must-not-exist'
        script = self.repo.path / 'hostile-helper'
        script.write_text('#!/bin/sh\ntouch ' + str(marker) + '\nexit 99\n')
        script.chmod(0o700)
        self.repo.git('config', 'diff.external', str(script))
        self.repo.git('config', 'diff.renames', 'true')
        self.repo.git('config', 'diff.ignoreSubmodules', 'all')
        self.repo.git('config', 'diff.hostile.command', str(script))
        self.repo.git('config', 'diff.hostile.textconv', str(script))
        (self.repo.path / '.gitattributes').write_text('* diff=hostile\n')
        result = self.catalog()
        self.assertEqual(result.entries[0].change, 'modified')
        self.assertFalse(marker.exists())

    def test_partial_promisor_repository_refused(self):
        self.repo.git('config', 'extensions.partialClone', 'unavailable')
        with self.assertRaises(ReaderError):
            self.catalog()

    def test_independent_raw_framing_status_modes_and_duplicates_refused(self):
        valid = self.raw_added()
        oid = blob_id(b'').encode()
        malformed = [valid[:-1], valid + b'garbage', valid + valid,
                     valid.replace(b' A\0', b' R100\0'),
                     valid.replace(b' A\0', b' X\0'),
                     valid.replace(b':000000', b':040000'),
                     valid.replace(b'100644', b'100664'),
                     valid.replace(b'0' * 40, oid, 1),
                     valid.replace(oid, b'0' * 40),
                     valid.replace(b' A\0', b' extra A\0'),
                     valid.replace(oid, oid[:-1]),
                     valid.replace(b'new.txt', b'../escape'),
                     valid.replace(b'new.txt', b'')]
        self.assertEqual(self.injected_raw(valid).entries,
                         (ChangedPath('new.txt', 'added', None, endpoint('100644', b''), True),))
        for raw in malformed:
            with self.subTest(raw=repr(raw[:140])), self.assertRaises(ReaderError):
                self.injected_raw(raw)

    def test_raw_prefix_mismatch_refused_not_postfiltered(self):
        with self.assertRaises(ReaderError):
            self.injected_raw(self.raw_added(b'src-extra/x'), directory='src')

    def test_raw_10000_inclusive_and_omissions_count_toward_limit(self):
        raw = b''.join(self.raw_added(f'p{i:05d}'.encode()) for i in range(9999))
        raw += self.raw_added(b'invalid-\xff')
        result = self.injected_raw(raw)
        self.assertEqual((len(result.entries), result.omitted_non_utf8_paths), (9999, 1))
        with self.assertRaises(ReaderError):
            self.injected_raw(raw + self.raw_added(b'one-too-many'))

    def test_controlled_raw_two_mib_exact_and_plus_one(self):
        # Parser admission only: the runner itself is deliberately bypassed here.
        record_bytes = 2048
        path_bytes = record_bytes - len(self.raw_added(b''))
        paths = [f'{i:04d}/'.encode() + b'x' * (path_bytes - 5) for i in range(1024)]
        raw = b''.join(self.raw_added(path) for path in paths)
        self.assertEqual(len(raw), 2 * 1024 * 1024)
        self.assertEqual(len(self.injected_raw(raw).entries), 1024)
        larger = raw[:-1] + b'x\0'
        self.assertEqual(len(larger), 2 * 1024 * 1024 + 1)
        with self.assertRaises(ReaderError):
            self.injected_raw(larger)

    def test_path_byte_cap_inclusive_and_plus_one(self):
        result = self.injected_raw(self.raw_added(b'x' * 4096))
        self.assertEqual(len(result.entries[0].path.encode()), 4096)
        with self.assertRaises(ReaderError):
            self.injected_raw(self.raw_added(b'x' * 4097))

    def test_exact_json_schema_and_structural_forgery_admission(self):
        result = self.catalog()
        expected = json.dumps(asdict(result), ensure_ascii=False, sort_keys=True, indent=2) + '\n'
        self.assertEqual(render_changed_files_json(result), expected)
        self.assertEqual(validate_changed_files(json.loads(expected)), result)
        forged = [replace(result, schema_version=True), replace(result, kind='other'),
                  replace(result, omitted_non_utf8_paths=-1),
                  replace(result, entries=result.entries * 2),
                  replace(result, entries=(replace(result.entries[0], change='added'),)),
                  replace(result, entries=(replace(result.entries[0], addressable=False),)),
                  replace(result, right_revision='a' * 64)]
        for value in forged:
            with self.subTest(value=value), self.assertRaises(ReaderError):
                validate_changed_files(value)
        decoded = json.loads(expected)
        decoded['unexpected'] = 'not admitted'
        with self.assertRaises(ReaderError):
            validate_changed_files(decoded)

    def test_independent_metadata_escape_growth_exceeds_eight_mib_atomically(self):
        # Direct structural fixture: this cannot pass the tighter native raw stdout cap.
        rows = tuple(ChangedPath(f'{i:05d}-' + '\n' * 450, 'added', None,
                                 endpoint('100644', b''), True) for i in range(10000))
        value = ChangedFileCatalog(1, 'changed-file-catalog', self.repo.path.name,
                                  self.left, self.left, self.right, self.right, '', rows, 0)
        independent = json.dumps(asdict(value), ensure_ascii=False, sort_keys=True, indent=2) + '\n'
        self.assertGreater(len(independent.encode()), 8 * 1024 * 1024)
        with self.assertRaises(ReaderError):
            render_changed_files_json(value)

    def test_independent_canonical_eight_mib_inclusive_and_plus_one(self):
        # Construct the exact canonical byte length using stdlib JSON, never SUT output.
        rows = tuple(ChangedPath(f'{i:05d}-', 'added', None,
                                 endpoint('100644', b''), True) for i in range(10000))
        value = ChangedFileCatalog(1, 'changed-file-catalog', self.repo.path.name,
                                  self.left, self.left, self.right, self.right, '', rows, 0)

        def independent_json(catalog):
            return json.dumps(asdict(catalog), ensure_ascii=False, sort_keys=True, indent=2) + '\n'

        maximum = 8 * 1024 * 1024
        extra = maximum - len(independent_json(value).encode())
        common, remainder = divmod(extra, len(rows))
        rows = [replace(row, path=row.path + 'x' * common) for row in rows]
        for index in range(len(rows) - 1, -1, -1):
            add = min(remainder, 4096 - len(rows[index].path))
            rows[index] = replace(rows[index], path=rows[index].path + 'x' * add)
            remainder -= add
            if not remainder:
                break
        self.assertEqual(remainder, 0)
        value = replace(value, entries=tuple(rows))
        expected = independent_json(value)
        self.assertEqual(len(expected.encode()), maximum)
        self.assertEqual(render_changed_files_json(value), expected)
        # First row has room and its numeric prefix still preserves byte order.
        rows[0] = replace(rows[0], path=rows[0].path + 'x')
        larger = replace(value, entries=tuple(rows))
        self.assertEqual(len(independent_json(larger).encode()), maximum + 1)
        with self.assertRaises(ReaderError):
            render_changed_files_json(larger)

    def test_existing_aggregate_cancel_propagates_without_git(self):
        cancel = Event()
        cancel.set()
        with work_budget(cancel=cancel), patch.object(GitRunner, 'run') as run:
            with self.assertRaises(WorkCancelled):
                self.catalog()
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
