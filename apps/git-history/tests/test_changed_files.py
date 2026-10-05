"""Original committed trees and literal wire facts for changed-file discovery."""
from dataclasses import asdict, replace
import hashlib
import json
import os
import threading
import unittest
from unittest.mock import patch

from git_history.changed_files import (
    ChangedEndpoint, ChangedPath, ChangedFileCatalog, list_changed_files,
    validate_changed_files, render_changed_files_json,
)
from git_history import changed_files
from git_history.reader import ReaderError
from git_history.work_budget import WorkCancelled, work_budget
from tests.helpers import Repository


def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def endpoint(data=b'x', mode='100644'):
    return ChangedEndpoint('regular', mode, blob(data))


def catalog(entries=()):
    return ChangedFileCatalog(1, 'changed-file-catalog', 'original', 'before', '1' * 40,
                              'after', '2' * 40, '', tuple(entries), 0)


class ChangedFilesTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.addCleanup(self.repo.close)

    def test_actual_git_framing_and_original_added_deleted_modified(self):
        self.repo.write('gone.txt', b'old\n')
        self.repo.write('edit.txt', b'left\n')
        left = self.repo.commit()
        (self.repo.path / 'gone.txt').unlink()
        self.repo.write('edit.txt', b'right\n')
        self.repo.write('new\tline\n雪.txt', b'')
        right = self.repo.commit()
        raw = self.repo.git('--literal-pathspecs', 'diff-tree', '--no-commit-id', '-r', '--raw',
                            '-z', '--no-abbrev', '--no-renames', '--no-ext-diff', '--no-textconv',
                            '--ignore-submodules=none', left, right, '--')
        left_blob, right_blob, old_blob = (blob(value) for value in (b"left\n", b"right\n", b"old\n"))
        expected = (
            f':100644 100644 {left_blob} {right_blob} M\0edit.txt\0'
            f':100644 000000 {old_blob} {"0" * 40} D\0gone.txt\0'
            f':000000 100644 {"0" * 40} {blob(b"")} A\0new\tline\n雪.txt\0'
        ).encode()
        self.assertEqual(raw, expected)
        result = list_changed_files(self.repo.path, left, right)
        self.assertEqual(result.entries, (
            ChangedPath('edit.txt', 'modified', endpoint(b'left\n'), endpoint(b'right\n'), True),
            ChangedPath('gone.txt', 'deleted', endpoint(b'old\n'), None, True),
            ChangedPath('new\tline\n雪.txt', 'added', None, endpoint(b''), True),
        ))
        self.assertEqual((result.left_revision, result.right_revision), (left, right))
        self.assertEqual(validate_changed_files(json.loads(render_changed_files_json(result))), result)

    def test_mode_type_gitlink_and_rename_are_literal_leaf_changes(self):
        for name in ('mode', 'both', 'move', 'type'):
            self.repo.write(name, 'same')
        left = self.repo.commit()
        (self.repo.path / 'mode').chmod(0o755)
        (self.repo.path / 'both').chmod(0o755)
        self.repo.write('both', 'changed')
        (self.repo.path / 'move').rename(self.repo.path / 'moved')
        (self.repo.path / 'type').unlink()
        (self.repo.path / 'type').symlink_to('/not/read/outside')
        self.repo.git('add', '--all')
        self.repo.git('update-index', '--add', '--cacheinfo', f'160000,{left},module')
        self.repo.git('commit', '-qm', 'right')
        right = self.repo.git('rev-parse', 'HEAD').decode().strip()
        result = list_changed_files(self.repo.path, left, right)
        rows = {entry.path: entry for entry in result.entries}
        self.assertEqual({p: e.change for p, e in rows.items()}, {
            'both': 'modified', 'mode': 'mode-changed', 'module': 'added',
            'move': 'deleted', 'moved': 'added', 'type': 'type-changed',
        })
        self.assertEqual(rows['module'].right, ChangedEndpoint('gitlink', '160000', left))
        self.assertEqual(rows['type'].right,
                         ChangedEndpoint('symlink', '120000', blob(b'/not/read/outside')))

    def test_pins_ignore_dirty_index_worktree_hostile_diff_config_and_move(self):
        self.repo.write('a', 'before')
        left = self.repo.commit()
        self.repo.write('a', 'after')
        right = self.repo.commit()
        self.repo.git('config', 'diff.external', '/never/execute')
        self.repo.git('config', 'diff.renames', 'copies')
        self.repo.git('config', 'diff.ignoreSubmodules', 'all')
        self.repo.write('a', 'dirty staged')
        self.repo.git('add', 'a')
        self.repo.write('a', 'dirty worktree')
        index = (self.repo.path / '.git/index').read_bytes()
        result = list_changed_files(self.repo.path, left, right)
        self.assertEqual(result.entries[0].right.object_id, blob(b'after'))
        self.assertEqual((self.repo.path / '.git/index').read_bytes(), index)
        self.assertEqual((self.repo.path / 'a').read_bytes(), b'dirty worktree')
        self.assertEqual(list_changed_files(self.repo.path, right, right).entries, ())

    def test_binary_large_blobs_are_not_read_and_literal_directory_is_exact(self):
        self.repo.write('base', '')
        left = self.repo.commit()
        for name in ('src/bin', 'src/large', 'src-extra/a', '[x]/a', 'C:/a', '\\odd'):
            self.repo.write(name, b'\xff\0' if 'large' not in name else b'x' * 600000)
        right = self.repo.commit()
        all_rows = list_changed_files(self.repo.path, left, right).entries
        self.assertFalse(next(e for e in all_rows if e.path == 'C:/a').addressable)
        self.assertFalse(next(e for e in all_rows if e.path == '\\odd').addressable)
        self.assertEqual([e.path for e in list_changed_files(self.repo.path, left, right, directory='src').entries],
                         ['src/bin', 'src/large'])
        self.assertEqual([e.path for e in list_changed_files(self.repo.path, left, right, directory='[x]').entries], ['[x]/a'])

    def test_non_utf8_path_omitted_and_counted(self):
        self.repo.write('base', '')
        left = self.repo.commit()
        with open(os.fsencode(self.repo.path) + b'/bad\xff', 'wb') as output:
            output.write(b'original')
        right = self.repo.commit()
        result = list_changed_files(self.repo.path, left, right)
        self.assertEqual((result.entries, result.omitted_non_utf8_paths), ((), 1))

    def test_argument_bounds_are_admitted_before_repository_access(self):
        for kwargs in ({'left_ref': ''}, {'left_ref': 'é' * 513}, {'right_ref': True},
                       {'directory': '../x'}, {'directory': 'a//b'}, {'directory': './a'},
                       {'directory': 'a/'}, {'directory': 'C:/a'}, {'directory': 'x' * 4097}):
            with self.subTest(kwargs=kwargs), patch.object(changed_files, '_resolve_repository', create=True) as resolve:
                with self.assertRaises(ValueError):
                    list_changed_files('/not/a/repository', **kwargs)
                resolve.assert_not_called()

    def test_exact_wire_validation_and_derived_addressability(self):
        valid = catalog([ChangedPath('x', 'added', None, endpoint(), True)])
        self.assertIs(validate_changed_files(valid), valid)
        self.assertEqual(validate_changed_files(asdict(valid)), valid)
        for change in (replace(valid, schema_version=True), replace(valid, omitted_non_utf8_paths=-1),
                       replace(valid, right_revision='a' * 64),
                       replace(valid, entries=(replace(valid.entries[0], change='modified'),)),
                       replace(valid, entries=(replace(valid.entries[0], addressable=False),)),
                       replace(valid, entries=valid.entries * 2)):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_changed_files(change)
        wire = asdict(valid)
        wire['extra'] = 1
        with self.assertRaises(ValueError):
            validate_changed_files(wire)
        wire = asdict(valid)
        wire['entries'][0]['right']['extra'] = 1
        with self.assertRaises(ValueError):
            validate_changed_files(wire)

    def test_validator_byte_counts_controls_and_utf8_order(self):
        row = ChangedPath('é' * 2048, 'added', None, endpoint(), True)
        self.assertEqual(validate_changed_files(catalog([row])).entries, (row,))
        with self.assertRaises(ValueError):
            validate_changed_files(catalog([replace(row, path=row.path + 'a')]))
        literal = catalog([ChangedPath('a\t\n<>&"', 'added', None, endpoint(), True)])
        self.assertEqual(json.loads(render_changed_files_json(literal))['entries'][0]['path'], 'a\t\n<>&"')
        with self.assertRaises(ValueError):
            validate_changed_files(catalog([replace(row, path='\ud800')]))

    def test_exact_count_limit_and_aggregate_omissions(self):
        rows = tuple(ChangedPath(f'f{i:05}', 'added', None, endpoint(), True) for i in range(10000))
        self.assertEqual(len(validate_changed_files(catalog(rows)).entries), 10000)
        with self.assertRaises(ValueError):
            validate_changed_files(replace(catalog(rows), omitted_non_utf8_paths=1))
        with self.assertRaises(ValueError):
            validate_changed_files(catalog((*rows, replace(rows[-1], path='last'))))

    def test_catalog_serialized_byte_limit_includes_escaped_controls(self):
        rows = tuple(ChangedPath(f'{i:04}-' + '\x01' * 1400, 'added', None, endpoint(), True)
                     for i in range(1000))
        with self.assertRaisesRegex(ValueError, '8 MiB'):
            render_changed_files_json(catalog(rows))

    def test_cancellation_and_partial_clone_refusal(self):
        cancel = threading.Event()
        cancel.set()
        with work_budget(cancel=cancel), self.assertRaises(WorkCancelled):
            list_changed_files(self.repo.path)
        self.repo.write('a', 'a')
        pin = self.repo.commit()
        self.repo.git('config', 'remote.origin.promisor', 'true')
        with self.assertRaisesRegex(ReaderError, 'complete local clone'):
            list_changed_files(self.repo.path, pin, pin)

    def test_frozen_dataclass_cannot_contain_mutable_wire_children(self):
        row = ChangedPath('x', 'added', None, endpoint(), True)
        for entry in (asdict(row), replace(row, right=asdict(endpoint()))):
            with self.subTest(entry=entry), self.assertRaises(ValueError):
                validate_changed_files(catalog([entry]))

    def test_raw_parser_rejects_malformed_and_preserves_literal_metadata(self):
        valid = f':000000 100644 {"0" * 40} {blob(b"x")} A\0x\0'.encode()
        rows, omitted = changed_files._parse_raw(valid, 40, '')
        self.assertEqual((rows, omitted), ((ChangedPath('x', 'added', None, endpoint(), True),), 0))
        bad = [valid[:-1], valid + b'extra\0', valid + valid,
               valid.replace(b' A\0', b' R100\0'), valid.replace(b' A\0', b' M\0'),
               valid.replace(b':000000', b':100644'), valid.replace(b'100644', b'040000'),
               valid.replace(b'x\0', b'../x\0'), valid.replace(b'x\0', b'bad\xff\0') + valid[:-1],
               b'x' * (2 * 1024 * 1024 + 1)]
        for raw in bad:
            with self.subTest(raw=raw[:100]), self.assertRaises(ValueError):
                changed_files._parse_raw(raw, 40, '')
        with self.assertRaises(ValueError):
            changed_files._parse_raw(valid, 40, 'src')

    def test_raw_limit_counts_omitted_paths_before_filtering(self):
        header = f':000000 100644 {"0" * 40} {blob(b"x")} A\0'.encode()
        raw = b''.join(header + f'bad{i:05}'.encode() + b'\xff\0' for i in range(10000))
        self.assertEqual(changed_files._parse_raw(raw, 40, ''), ((), 10000))
        with self.assertRaisesRegex(ValueError, '10,000'):
            changed_files._parse_raw(raw + header + b'one-more\0', 40, '')

    def test_sha256_repository_and_file_directory_replacement(self):
        self.repo.git('init', '-q', '--object-format=sha256', 'sha256')
        nested = self.repo.path / 'sha256'
        self.repo.git('-C', str(nested), 'config', 'user.name', 'Original')
        self.repo.git('-C', str(nested), 'config', 'user.email', 'original@example.invalid')
        (nested / 'path').write_bytes(b'old')
        self.repo.git('-C', str(nested), 'add', '.')
        self.repo.git('-C', str(nested), 'commit', '-qm', 'left')
        left = self.repo.git('-C', str(nested), 'rev-parse', 'HEAD').decode().strip()
        (nested / 'path').unlink()
        (nested / 'path').mkdir()
        (nested / 'path/child').write_bytes(b'new')
        self.repo.git('-C', str(nested), 'add', '--all')
        self.repo.git('-C', str(nested), 'commit', '-qm', 'right')
        right = self.repo.git('-C', str(nested), 'rev-parse', 'HEAD').decode().strip()
        result = list_changed_files(nested, left, right)
        self.assertEqual([(r.path, r.change) for r in result.entries], [('path', 'deleted'), ('path/child', 'added')])
        self.assertEqual(result.entries[1].right.object_id, hashlib.sha256(b'blob 3\0new').hexdigest())
        self.assertEqual(len(result.left_revision), 64)


if __name__ == '__main__':
    unittest.main()
