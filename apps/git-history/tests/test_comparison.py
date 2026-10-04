"""Real committed sources exercise selection, alignment and admission boundaries."""
from dataclasses import FrozenInstanceError, replace
import hashlib
import threading
import unittest
from unittest.mock import patch

from git_history.comparison import (
    MAX_ALIGNMENT_CELLS, MAX_COMPARE_BYTES, MAX_COMPARE_LINES,
    CompareSelection, CompareTarget, ComparisonBlock, compare_repository,
    validate_comparison,
)
from git_history import comparison, reader
from git_history.work_budget import WorkCancelled, work_budget
from tests.helpers import Repository


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.addCleanup(self.repo.close)

    def pair(self, left, right, selection=None):
        self.repo.write('left.txt', left)
        self.repo.write('right.txt', right)
        revision = self.repo.commit()
        selection = selection or CompareSelection('whole')
        return compare_repository(self.repo.path,
                                  CompareTarget(revision, 'left.txt', selection),
                                  CompareTarget(revision, 'right.txt', selection))

    def test_literal_alignment_and_delete_first_repeated_tie(self):
        report = self.pair('a\nb\n', 'b\na\n')
        self.assertEqual(report.blocks, (
            ComparisonBlock('change', 0, 1, 0, 0),
            ComparisonBlock('equal', 1, 2, 0, 1),
            ComparisonBlock('change', 2, 2, 1, 2),
        ))
        self.assertEqual((report.unchanged_lines, report.removed_lines, report.added_lines),
                         (1, 1, 1))
        self.assertIs(validate_comparison(report), report)

    def test_preserves_bom_crlf_unicode_separator_and_missing_final_lf(self):
        report = self.pair('\ufeffa\r\nu\u2028v\nlast', '\ufeffa\r\nu\u2028v\nlast\n')
        self.assertEqual(report.left.source, '\ufeffa\r\nu\u2028v\nlast')
        self.assertEqual(report.left.end_line, 3)
        self.assertEqual(report.blocks, (ComparisonBlock('equal', 0, 2, 0, 2),
                                         ComparisonBlock('change', 2, 3, 2, 3)))
        self.assertEqual(report.left.source_sha256,
                         hashlib.sha256(report.left.source.encode()).hexdigest())

    def test_range_slices_original_terminators_and_line_provenance(self):
        report = self.pair('skip\r\n\r\nlast', 'skip\r\n\r\nlast',
                           CompareSelection('lines', 2, 3))
        self.assertEqual(report.left.source, '\r\nlast')
        self.assertEqual((report.left.start_line, report.left.end_line), (2, 3))
        self.assertEqual(report.unchanged_lines, 2)

    def test_newline_only_file_is_one_line_but_empty_file_has_zero(self):
        report = self.pair('', '\n')
        self.assertIsNone(report.left.start_line)
        self.assertIsNone(report.left.end_line)
        self.assertEqual(report.left.status, 'present')
        self.assertEqual(report.left.source_sha256, hashlib.sha256(b'').hexdigest())
        self.assertEqual(report.right.end_line, 1)
        self.assertEqual(report.blocks, (ComparisonBlock('change', 0, 0, 0, 1),))
        self.assertEqual(self.pair('', '').blocks, ())

    def test_missing_is_verified_and_not_an_empty_file(self):
        self.repo.write('empty.txt', '')
        revision = self.repo.commit()
        missing = CompareTarget(revision, 'absent.txt', CompareSelection('missing'))
        empty = CompareTarget(revision, 'empty.txt', CompareSelection('whole'))
        report = compare_repository(self.repo.path, missing, empty)
        self.assertEqual(report.left.status, 'missing')
        self.assertIsNone(report.left.source_sha256)
        self.assertEqual(report.right.status, 'present')
        self.assertEqual(report.blocks, ())
        self.assertIsNone(reader.read_source_or_missing(self.repo.path, 'absent.txt', revision))
        with self.assertRaises(reader.ReaderError):
            reader.read_source(self.repo.path, 'absent.txt', revision)
        for left, right in [(missing, missing),
                            (replace(empty, selection=CompareSelection('missing')), missing),
                            (replace(missing, selection=CompareSelection('whole')), empty)]:
            with self.subTest(left=left, right=right), self.assertRaises(ValueError):
                compare_repository(self.repo.path, left, right)

    def test_absence_helper_does_not_hide_unsupported_source_or_bad_refs(self):
        self.repo.write('folder/file.txt', 'hello')
        self.repo.write('binary.txt', b'\0')
        self.repo.write('invalid.txt', b'\xff')
        self.repo.write('large.txt', b'x' * (MAX_COMPARE_BYTES + 1))
        (self.repo.path / 'link.txt').symlink_to('folder/file.txt')
        revision = self.repo.commit()
        for path in ['folder', 'binary.txt', 'invalid.txt', 'large.txt', 'link.txt',
                     '../missing.txt', '/missing.txt']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                reader.read_source_or_missing(self.repo.path, path, revision)
        with self.assertRaises(reader.ReaderError):
            reader.read_source_or_missing(self.repo.path, 'absent.txt', 'invalid-ref')

    def test_missing_cannot_mislabel_git_normalized_path_aliases(self):
        self.repo.write('folder/file.txt', 'hello')
        revision = self.repo.commit()
        present = CompareTarget(revision, 'folder/file.txt', CompareSelection('whole'))
        for path in ['folder/', './folder', 'folder//', './folder/file.txt',
                     'folder//file.txt', 'folder/.', '.']:
            with self.subTest(path=path):
                with self.assertRaisesRegex(ValueError, 'exact|canonical'):
                    reader.read_source_or_missing(self.repo.path, path, revision)
                with self.assertRaises(ValueError):
                    compare_repository(self.repo.path,
                                       CompareTarget(revision, path, CompareSelection('missing')),
                                       present)

    def test_each_named_ref_is_pinned_before_reads_and_uncommitted_edits_are_ignored(self):
        self.repo.write('value.txt', 'before\n')
        old = self.repo.commit()
        self.repo.git('branch', 'left')
        self.repo.git('branch', 'right')
        self.repo.write('value.txt', 'after\n')
        new = self.repo.commit()
        self.repo.write('value.txt', 'uncommitted\n')
        original = reader.read_source_or_missing
        calls = []

        def read_after_branch_move(repo, path, ref='HEAD'):
            calls.append(ref)
            self.repo.git('branch', '-f', 'left', new)
            self.repo.git('branch', '-f', 'right', new)
            return original(repo, path, ref)

        with patch.object(comparison, 'read_source_or_missing', side_effect=read_after_branch_move):
            report = compare_repository(self.repo.path,
                                        CompareTarget('left', 'value.txt', CompareSelection('whole')),
                                        CompareTarget('right', 'value.txt', CompareSelection('whole')))
        self.assertEqual(calls, [old, old])
        self.assertEqual(report.left.revision, old)
        self.assertEqual(report.right.revision, old)
        self.assertEqual(report.left.requested_ref, 'left')
        self.assertEqual(report.right.requested_ref, 'right')
        self.assertEqual(report.left.source, 'before\n')
        self.assertEqual(reader.resolve_revision(self.repo.path, 'left').revision, new)

    def test_exact_function_selection_preserves_decorators_and_rejects_ambiguity(self):
        self.repo.write('source.py', '@marker\ndef f():\n    return 1\n\ndef f():\n    return 2\n')
        revision = self.repo.commit()
        target = CompareTarget(revision, 'source.py', CompareSelection('function', function='f'))
        with self.assertRaisesRegex(reader.ReaderError, 'Ambiguous'):
            compare_repository(self.repo.path, target, target)
        self.repo.write('source.py', '# first\n@marker\ndef f():\n    return 1\n')
        revision = self.repo.commit()
        target = replace(target, ref=revision)
        report = compare_repository(self.repo.path, target, target)
        self.assertEqual(report.left.source, '@marker\ndef f():\n    return 1\n')
        self.assertEqual((report.left.start_line, report.left.end_line), (2, 4))
        self.assertEqual(report.left.selected_function, 'f')
        with self.assertRaises(reader.ReaderError):
            bad = replace(target, selection=CompareSelection('function', function='missing'))
            compare_repository(self.repo.path, bad, target)

    def test_exact_200_lines_and_512kib_bytes_admit_and_next_line_rejects(self):
        self.assertEqual((MAX_COMPARE_LINES, MAX_ALIGNMENT_CELLS), (200, 40_000))
        text = 'a\n' * 200
        self.assertEqual(self.pair(text, text).unchanged_lines, 200)
        with self.assertRaisesRegex(ValueError, '200'):
            self.pair(text + 'a\n', text)
        report = self.pair('x' * MAX_COMPARE_BYTES, 'x' * MAX_COMPARE_BYTES)
        self.assertEqual(report.unchanged_lines, 1)
        self.repo.write('source.txt', 'line\n' * 201)
        revision = self.repo.commit()
        target = CompareTarget(revision, 'source.txt', CompareSelection('lines', 2, 201))
        self.assertEqual(compare_repository(self.repo.path, target, target).unchanged_lines, 200)

    def test_strict_request_types_and_complete_selection_combinations(self):
        self.repo.write('source.txt', 'line\n')
        revision = self.repo.commit()
        good = CompareTarget(revision, 'source.txt', CompareSelection('whole'))
        choices = [CompareSelection('whole', 1), CompareSelection('missing', function='f'),
                   CompareSelection('lines', True, 1), CompareSelection('lines', 1, 201),
                   CompareSelection('lines', 1, 1, 'f'), CompareSelection('lines', 2, 1),
                   CompareSelection('function'), CompareSelection('function', function='\ud800'),
                   CompareSelection('function', function='x' * 8193), CompareSelection('unknown')]
        for selection in choices:
            with self.subTest(selection=selection), self.assertRaises(ValueError):
                compare_repository(self.repo.path, replace(good, selection=selection), good)
        for target in [replace(good, ref='x' * 1025), replace(good, path='x' * 4097),
                       replace(good, path=True), replace(good, selection={}), {'ref': revision}]:
            with self.subTest(target=target), self.assertRaises(ValueError):
                compare_repository(self.repo.path, target, good)

    def test_direct_validation_rejects_forged_alignment_counts_hash_and_provenance(self):
        report = self.pair('same\n', 'same\n')
        forged = replace(report, blocks=(ComparisonBlock('change', 0, 1, 0, 1),),
                         unchanged_lines=0, removed_lines=1, added_lines=1)
        bad = [forged, replace(report, blocks=list(report.blocks)),
               replace(report, unchanged_lines=True), replace(report, schema_version=True),
               replace(report, kind='history'), replace(report, removed_lines=1),
               replace(report, left=replace(report.left, source_sha256='0' * 64)),
               replace(report, left=replace(report.left, revision='HEAD')),
               replace(report, left=replace(report.left, start_line=2)),
               replace(report, left=replace(report.left, selected_function='f')),
               replace(report, left=replace(report.left, selection=CompareSelection('missing')))]
        for candidate in bad:
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                validate_comparison(candidate)
        with self.assertRaises(FrozenInstanceError):
            report.added_lines = 100

    def test_cancellation_propagates_before_source_and_during_alignment_validation(self):
        report = self.pair('a\n' * 200, 'b\n' * 200)
        cancel = threading.Event()
        cancel.set()
        with work_budget(cancel=cancel), self.assertRaises(WorkCancelled):
            validate_comparison(report)
        target = CompareTarget(report.left.revision, 'left.txt', CompareSelection('whole'))
        with work_budget(cancel=cancel), self.assertRaises(WorkCancelled):
            compare_repository(self.repo.path, target, target)
        checks = 0
        original = comparison.check_work_budget

        def cancel_in_stage():
            nonlocal checks
            checks += 1
            if checks == 12:
                cancel.set()
            original()

        cancel.clear()
        with work_budget(cancel=cancel), patch.object(comparison, 'check_work_budget',
                                                     side_effect=cancel_in_stage):
            with self.assertRaises(WorkCancelled):
                validate_comparison(report)


if __name__ == '__main__':
    unittest.main()
