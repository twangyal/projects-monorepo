"""Independent literal-source expectations; no producer alignment builds the oracle."""
from dataclasses import FrozenInstanceError, replace
import hashlib
from threading import Event
import unittest
from unittest.mock import patch

from git_history import reader
from git_history.comparison import (
    CompareSelection, CompareTarget, ComparisonBlock,
    MAX_ALIGNMENT_CELLS, MAX_COMPARE_BYTES, MAX_COMPARE_LINES,
    compare_repository, validate_comparison,
)
from git_history.work_budget import WorkCancelled, work_budget
from tests.helpers import Repository


class ComparisonOracleTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.addCleanup(self.repo.close)

    def target(self, path, ref='HEAD', kind='whole', **fields):
        return CompareTarget(ref, path, CompareSelection(kind, **fields))

    def pair(self, left, right):
        self.repo.write('left.txt', left)
        self.repo.write('right.txt', right)
        revision = self.repo.commit('Literal independent source pair')
        report = compare_repository(self.repo.path, self.target('left.txt'),
                                    self.target('right.txt'))
        self.assertEqual(report.left.revision, revision)
        self.assertEqual(report.right.revision, revision)
        self.assertEqual(report.left.source, left)
        self.assertEqual(report.right.source, right)
        self.assertEqual(report.left.source_sha256, hashlib.sha256(left.encode()).hexdigest())
        self.assertEqual(report.right.source_sha256, hashlib.sha256(right.encode()).hexdigest())
        return report

    def alignment(self, report, blocks, counts):
        self.assertIs(type(report.blocks), tuple)
        self.assertEqual([(b.kind, b.left_start, b.left_end, b.right_start, b.right_end)
                          for b in report.blocks], blocks)
        self.assertEqual((report.unchanged_lines, report.removed_lines, report.added_lines),
                         counts)
        self.assertIs(validate_comparison(report), report)

    def test_literal_replacements_and_one_sided_tail(self):
        report = self.pair('a\nb\nc\nd\n', 'a\nB\nc\ne\nf\n')
        self.alignment(report, [('equal', 0, 1, 0, 1), ('change', 1, 2, 1, 2),
                                ('equal', 2, 3, 2, 3), ('change', 3, 4, 3, 5)], (2, 2, 3))
        self.assertEqual((report.schema_version, report.kind), (1, 'source-comparison'))
        self.assertEqual(report.repo_name, self.repo.path.name)
        self.assertEqual((report.left.requested_ref, report.right.requested_ref), ('HEAD', 'HEAD'))
        self.assertEqual((report.left.start_line, report.left.end_line), (1, 4))
        self.assertEqual((report.right.start_line, report.right.end_line), (1, 5))

    def test_repeated_lines_delete_first_tie_is_exact(self):
        report = self.pair('A\nB\nA\n', 'B\nA\nB\n')
        self.alignment(report, [('change', 0, 1, 0, 0), ('equal', 1, 3, 0, 2),
                                ('change', 3, 3, 2, 3)], (2, 1, 1))

    def test_crossed_pair_does_not_invent_moved_line_identity(self):
        report = self.pair('a\nb\n', 'b\na\n')
        self.alignment(report, [('change', 0, 1, 0, 0), ('equal', 1, 2, 0, 1),
                                ('change', 2, 2, 1, 2)], (1, 1, 1))

    def test_final_lf_is_a_real_change_without_phantom_line(self):
        report = self.pair('same\n', 'same')
        self.alignment(report, [('change', 0, 1, 0, 1)], (0, 1, 1))
        self.assertEqual((report.left.end_line, report.right.end_line), (1, 1))

    def test_bom_crlf_and_unicode_separators_are_not_normalized(self):
        report = self.pair('\ufeffa\r\nb\u2028c\r\nlast', '\ufeffa\nb\u2028c\r\nlast\n')
        self.alignment(report, [('change', 0, 1, 0, 1), ('equal', 1, 2, 1, 2),
                                ('change', 2, 3, 2, 3)], (1, 2, 2))
        self.assertEqual((report.left.end_line, report.right.end_line), (3, 3))

    def test_empty_present_file_and_one_empty_physical_line_are_distinct(self):
        report = self.pair('', '\n')
        self.alignment(report, [('change', 0, 0, 0, 1)], (0, 0, 1))
        self.assertEqual(report.left.status, 'present')
        self.assertEqual((report.left.start_line, report.left.end_line), (None, None))
        self.assertEqual((report.right.start_line, report.right.end_line), (1, 1))
        self.assertEqual(report.left.source_sha256, hashlib.sha256(b'').hexdigest())

    def test_identical_empty_files_have_no_blocks(self):
        self.alignment(self.pair('', ''), [], (0, 0, 0))

    def test_manual_ranges_preserve_original_coordinates_and_text(self):
        self.repo.write('left.txt', 'skip\nsecond\rpart\nthird\nlast')
        self.repo.write('right.txt', 'skip\nsecond\rpart\nTHIRD\nlast')
        revision = self.repo.commit()
        report = compare_repository(self.repo.path,
                                    self.target('left.txt', revision, 'lines', start=2, end=3),
                                    self.target('right.txt', revision, 'lines', start=2, end=3))
        self.assertEqual(report.left.source, 'second\rpart\nthird\n')
        self.assertEqual(report.right.source, 'second\rpart\nTHIRD\n')
        self.assertEqual((report.left.start_line, report.left.end_line), (2, 3))
        self.alignment(report, [('equal', 0, 1, 0, 1), ('change', 1, 2, 1, 2)], (1, 1, 1))
        final = compare_repository(self.repo.path,
                                   self.target('left.txt', revision, 'lines', start=4, end=4),
                                   self.target('right.txt', revision, 'lines', start=4, end=4))
        self.assertEqual(final.left.source, 'last')
        self.alignment(final, [('equal', 0, 1, 0, 1)], (1, 0, 0))

    def test_independent_named_functions_keep_names_and_decorator_bounds(self):
        self.repo.write('left.py', '# header\n@decorate\ndef before():\n    return 1\n')
        self.repo.write('right.py', '# other header\n\ndef after():\n    return 2\n')
        revision = self.repo.commit()
        report = compare_repository(self.repo.path,
                                    self.target('left.py', revision, 'function', function='before'),
                                    self.target('right.py', revision, 'function', function='after'))
        self.assertEqual(report.left.source, '@decorate\ndef before():\n    return 1\n')
        self.assertEqual(report.right.source, 'def after():\n    return 2\n')
        self.assertEqual((report.left.start_line, report.left.end_line), (2, 4))
        self.assertEqual((report.right.start_line, report.right.end_line), (3, 4))
        self.assertEqual((report.left.selected_function, report.right.selected_function),
                         ('before', 'after'))
        self.alignment(report, [('change', 0, 3, 0, 2)], (0, 3, 2))

    def test_explicit_rename_paths_and_added_removed_sides(self):
        self.repo.write('old name.txt', 'kept\n')
        old = self.repo.commit()
        self.repo.git('mv', 'old name.txt', 'new name.txt')
        new = self.repo.commit('Explicit rename chosen by user')
        report = compare_repository(self.repo.path, self.target('old name.txt', old),
                                    self.target('new name.txt', new))
        self.alignment(report, [('equal', 0, 1, 0, 1)], (1, 0, 0))
        removed = compare_repository(self.repo.path, self.target('old name.txt', old),
                                     self.target('old name.txt', new, 'missing'))
        self.alignment(removed, [('change', 0, 1, 0, 0)], (0, 1, 0))
        added = compare_repository(self.repo.path, self.target('new name.txt', old, 'missing'),
                                   self.target('new name.txt', new))
        self.alignment(added, [('change', 0, 0, 0, 1)], (0, 0, 1))
        self.assertEqual(added.left.status, 'missing')
        self.assertEqual((added.left.source, added.left.source_sha256,
                          added.left.start_line, added.left.end_line), ('', None, None, None))

    def test_absent_and_present_empty_metadata_differ_even_without_rows(self):
        self.repo.write('empty.txt', '')
        revision = self.repo.commit()
        report = compare_repository(self.repo.path, self.target('gone.txt', revision, 'missing'),
                                    self.target('empty.txt', revision))
        self.alignment(report, [], (0, 0, 0))
        self.assertEqual((report.left.status, report.right.status), ('missing', 'present'))
        self.assertIsNone(report.left.source_sha256)
        self.assertEqual(report.right.source_sha256, hashlib.sha256(b'').hexdigest())
        for left, right in [(self.target('gone.txt'), self.target('empty.txt')),
                            (self.target('empty.txt', kind='missing'), self.target('empty.txt')),
                            (self.target('gone.txt', kind='missing'),
                             self.target('also-gone.txt', kind='missing'))]:
            with self.subTest(left=left), self.assertRaises(ValueError):
                compare_repository(self.repo.path, left, right)

    def test_full_commit_pins_ignore_worktree_and_branch_movement(self):
        self.repo.write('file.txt', 'first\n')
        first = self.repo.commit()
        self.repo.write('file.txt', 'second\n')
        second = self.repo.commit()
        self.repo.git('branch', 'moving-right', second)
        self.repo.write('file.txt', 'third\n')
        third = self.repo.commit()
        self.repo.write('file.txt', 'UNCOMMITTED\n')
        run = reader.GitRunner.run
        moved = False

        def move_during_source(instance, *args, **kwargs):
            nonlocal moved
            if 'cat-file' in args and not moved:
                moved = True
                self.repo.git('update-ref', 'refs/heads/moving-right', third)
            return run(instance, *args, **kwargs)

        with patch.object(reader.GitRunner, 'run', move_during_source):
            report = compare_repository(self.repo.path, self.target('file.txt', first),
                                        self.target('file.txt', 'moving-right'))
        self.assertTrue(moved)
        self.assertEqual((report.left.revision, report.right.revision), (first, second))
        self.assertEqual((report.left.source, report.right.source), ('first\n', 'second\n'))
        self.assertEqual(report.right.requested_ref, 'moving-right')

    def test_disjoint_ancestry_needs_no_merge_base(self):
        self.repo.write('before.txt', 'unrelated left\n')
        before = self.repo.commit()
        self.repo.git('checkout', '-q', '--orphan', 'other-root')
        self.repo.git('rm', '-q', '-rf', '.')
        self.repo.write('after.txt', 'unrelated right\n')
        after = self.repo.commit()
        report = compare_repository(self.repo.path, self.target('before.txt', before),
                                    self.target('after.txt', after))
        self.alignment(report, [('change', 0, 1, 0, 1)], (0, 1, 1))

    def test_exact_two_hundred_lines_and_smaller_range_from_long_file(self):
        left = ''.join(f'L{i}\n' for i in range(200))
        right = ''.join(f'R{i}\n' for i in range(200))
        self.alignment(self.pair(left, right), [('change', 0, 200, 0, 200)], (0, 200, 200))
        self.assertEqual((MAX_COMPARE_LINES, MAX_ALIGNMENT_CELLS, MAX_COMPARE_BYTES),
                         (200, 40_000, 512 * 1024))
        self.repo.write('long.txt', left + 'extra\n')
        revision = self.repo.commit()
        with self.assertRaises(ValueError):
            compare_repository(self.repo.path, self.target('long.txt', revision),
                               self.target('right.txt', revision))
        report = compare_repository(self.repo.path,
                                    self.target('long.txt', revision, 'lines', start=2, end=201),
                                    self.target('right.txt', revision))
        self.assertEqual((report.left.start_line, report.left.end_line), (2, 201))
        self.assertEqual(report.left.source, left[len('L0\n'):] + 'extra\n')

    def test_exact_blob_byte_cap_with_long_single_line(self):
        text = 'é' * (512 * 1024 // 2)
        self.alignment(self.pair(text, text), [('equal', 0, 1, 0, 1)], (1, 0, 0))
        self.repo.write('too-big.txt', text + 'a')
        revision = self.repo.commit()
        for kind in ('whole', 'missing'):
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                compare_repository(self.repo.path, self.target('too-big.txt', revision, kind),
                                   self.target('right.txt', revision))

    def test_errors_do_not_become_missing_and_literal_paths_stay_literal(self):
        path = '-[literal]*; name\t.txt'
        self.repo.write(path, '<script>literal</script>\n')
        self.repo.write('directory/child.txt', 'child\n')
        self.repo.write('binary.txt', b'bad\x00text')
        self.repo.write('invalid.txt', b'\xff')
        (self.repo.path / 'link.txt').symlink_to(path)
        revision = self.repo.commit()
        report = compare_repository(self.repo.path, self.target(path, revision),
                                    self.target(path, revision))
        self.assertEqual(report.left.path, path)
        self.assertEqual(report.left.source, '<script>literal</script>\n')
        for forbidden in ('directory', 'binary.txt', 'invalid.txt', 'link.txt', '../outside',
                          '/absolute', 'directory/../binary.txt'):
            with self.subTest(path=forbidden), self.assertRaises(ValueError):
                compare_repository(self.repo.path, self.target(forbidden, revision, 'missing'),
                                   self.target(path, revision))
        with self.assertRaises(ValueError):
            compare_repository(self.repo.path, self.target(path, '--help', 'missing'),
                               self.target(path, revision))

    def test_missing_rejects_aliases_of_existing_files_and_directories(self):
        self.repo.write('dir/file.txt', 'existing committed source\n')
        revision = self.repo.commit()
        for path in ('dir/', './dir', 'dir//file.txt', './dir/file.txt'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                compare_repository(self.repo.path, self.target(path, revision, 'missing'),
                                   self.target('dir/file.txt', revision))

    def test_canonical_validation_rejects_forged_changes_even_valid_partitions(self):
        report = self.pair('same\n', 'same\n')
        forged = replace(report, blocks=(ComparisonBlock('change', 0, 1, 0, 1),),
                         unchanged_lines=0, removed_lines=1, added_lines=1)
        with self.assertRaises(ValueError):
            validate_comparison(forged)
        for forged in (replace(report, unchanged_lines=True),
                       replace(report, blocks=list(report.blocks)),
                       replace(report, left=replace(report.left, source_sha256='0' * 64))):
            with self.subTest(report=forged), self.assertRaises(ValueError):
                validate_comparison(forged)
        with self.assertRaises(FrozenInstanceError):
            report.added_lines = 99

    def test_noncanonical_equal_tie_cannot_be_relabelled_as_another_valid_lcs(self):
        report = self.pair('a\nb\n', 'b\na\n')
        forged = replace(report, blocks=(ComparisonBlock('change', 0, 0, 0, 1),
                                        ComparisonBlock('equal', 0, 1, 1, 2),
                                        ComparisonBlock('change', 1, 2, 2, 2)))
        with self.assertRaises(ValueError):
            validate_comparison(forged)

    def test_precancelled_budget_escapes_without_partial_report(self):
        self.repo.write('file.txt', 'one\n')
        self.repo.commit()
        cancelled = Event()
        cancelled.set()
        with work_budget(cancel=cancelled), self.assertRaises(WorkCancelled):
            compare_repository(self.repo.path, self.target('file.txt'), self.target('file.txt'))


if __name__ == '__main__':
    unittest.main()
