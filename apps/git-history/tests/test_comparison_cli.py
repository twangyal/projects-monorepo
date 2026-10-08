"""Real committed inputs and atomic/budgeted additive comparison CLI."""
from contextlib import redirect_stderr, redirect_stdout
import io
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch

from tests.helpers import Repository
from git_history import cli
from git_history.work_budget import (
    WorkCancelled, WorkDeadlineExceeded, WorkOutputLimit, current_work_budget, work_budget,
)


class ComparisonCliTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.addCleanup(self.repo.close)
        self.repo.write('before.py', 'def old():\n    return 1\n')
        self.first = self.repo.commit('Before')
        self.repo.git('mv', 'before.py', 'after.py')
        self.repo.write('after.py', 'def new():\n    return 2\n')
        self.last = self.repo.commit('After')
        self.base = ['compare', '--repo', str(self.repo.path), '--left-ref', self.first,
                     '--left-file', 'before.py', '--left-whole', '--right-ref', self.last,
                     '--right-file', 'after.py', '--right-whole']

    def run_cli(self, args):
        return subprocess.run([sys.executable, '-m', 'git_history', *args],
                              cwd=Path(__file__).resolve().parents[1],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)

    def test_real_two_commit_json_and_worktree_independence(self):
        self.repo.write('after.py', 'DIRTY NOT COMMITTED\n')
        result = self.run_cli([*self.base, '--format', 'json'])
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        report = json.loads(result.stdout)
        self.assertEqual((report['schema_version'], report['kind']), (1, 'source-comparison'))
        self.assertEqual(report['left']['revision'], self.first)
        self.assertEqual(report['right']['revision'], self.last)
        self.assertEqual(report['left']['source'], 'def old():\n    return 1\n')
        self.assertEqual(report['right']['source'], 'def new():\n    return 2\n')
        self.assertEqual((report['unchanged_lines'], report['removed_lines'], report['added_lines']),
                         (0, 2, 2))

    def test_manual_and_exact_function_modes(self):
        args = [x for x in self.base if x not in ('--left-whole', '--right-whole')]
        result = self.run_cli([*args, '--left-function', 'old', '--right-lines', '1:2',
                               '--format', 'json'])
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        item = json.loads(result.stdout)
        self.assertEqual(item['left']['selected_function'], 'old')
        self.assertEqual(item['right']['selection'],
                         {'kind': 'lines', 'start': 1, 'end': 2, 'function': None})

    def test_explicit_missing_and_present_error_no_silent_conversion(self):
        args = [x for x in self.base if x != '--right-whole']
        args[args.index('--right-file') + 1] = 'before.py'
        good = self.run_cli([*args, '--right-missing', '--format', 'json'])
        self.assertEqual(good.returncode, 0, good.stderr.decode())
        self.assertEqual(json.loads(good.stdout)['right']['status'], 'missing')
        bad = self.run_cli([*args, '--right-whole', '--format', 'json'])
        self.assertEqual(bad.returncode, 2)
        self.assertEqual(bad.stdout, b'')

    def test_each_selection_required_exclusive_and_legacy_flags_rejected(self):
        variants = [[x for x in self.base if x != '--left-whole'],
                    [*self.base, '--right-lines', '1:2'],
                    [*self.base, '--context', 'anything.json'],
                    [*self.base, '--max-commits', '1'],
                    [*self.base, '--left-lines', '1:201']]
        for args in variants:
            with self.subTest(args=args):
                result = self.run_cli(args)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, b'')

    def test_atomic_no_clobber_force_and_git_metadata_protection(self):
        target = self.repo.path / 'comparison.html'
        good = self.run_cli([*self.base, '--output', str(target)])
        self.assertEqual(good.returncode, 0, good.stderr.decode())
        initial = target.read_bytes()
        self.assertIn(b'<!doctype html>', initial.lower())
        target.write_text('prior', encoding='utf-8')
        denied = self.run_cli([*self.base, '--output', str(target)])
        self.assertEqual(denied.returncode, 2)
        self.assertEqual(target.read_text(), 'prior')
        forced = self.run_cli([*self.base, '--output', str(target), '--force'])
        self.assertEqual(forced.returncode, 0, forced.stderr.decode())
        self.assertEqual(target.read_bytes(), initial)
        forbidden = self.repo.path / '.git' / 'forbidden.html'
        denied = self.run_cli([*self.base, '--output', str(forbidden)])
        self.assertEqual(denied.returncode, 2)
        self.assertFalse(forbidden.exists())
        self.assertEqual(list(self.repo.path.glob('.git-history-*')), [])

    def test_failed_selection_keeps_forced_destination_unchanged(self):
        target = self.repo.path / 'prior.json'
        target.write_text('saved-before', encoding='utf-8')
        args = [x for x in self.base if x != '--right-whole']
        result = self.run_cli([*args, '--right-lines', '99:100', '--output', str(target), '--force'])
        self.assertEqual(result.returncode, 2)
        self.assertEqual(target.read_text(), 'saved-before')
        self.assertEqual(list(self.repo.path.glob('.git-history-*')), [])

    def test_compare_owns_45_second_32_mib_budget_and_catches_only_trusted_errors(self):
        def fail(*_args):
            budget = current_work_budget()
            self.assertIsNotNone(budget)
            self.assertEqual(budget.max_output_bytes, 32 * 1024 * 1024)
            self.assertGreater(budget.deadline - time.monotonic(), 44)
            self.assertLessEqual(budget.deadline - time.monotonic(), 45)
            raise WorkDeadlineExceeded('Trusted deadline')
        with patch('git_history.cli.compare_repository', side_effect=fail), \
                redirect_stdout(io.StringIO()) as out, redirect_stderr(io.StringIO()) as err:
            self.assertEqual(cli.main(self.base), 2)
            self.assertEqual(out.getvalue(), '')
            self.assertIn('Trusted deadline', err.getvalue())
        for failure in (WorkCancelled('cancelled'), WorkOutputLimit('output bound')):
            with patch('git_history.cli.compare_repository', side_effect=failure), \
                    redirect_stderr(io.StringIO()), redirect_stdout(io.StringIO()):
                self.assertEqual(cli.main(self.base), 2)
        with patch('git_history.cli.compare_repository', side_effect=RuntimeError('untrusted')):
            with self.assertRaisesRegex(RuntimeError, 'untrusted'):
                cli.main(self.base)

    def test_cancellation_after_renderer_prevents_stdout_and_file_publication(self):
        cancel = threading.Event()

        def own_budget(**kwargs):
            return work_budget(cancel=cancel, **kwargs)

        def cancelling_renderer(_report):
            cancel.set()
            return 'rendered but cancelled'

        target = self.repo.path / 'prior.json'
        for output in ([], ['--output', str(target), '--force']):
            target.write_text('before', encoding='utf-8')
            cancel.clear()
            with patch('git_history.cli.work_budget', side_effect=own_budget), \
                    patch('git_history.cli.compare_repository', return_value=object()), \
                    patch('git_history.cli.render_comparison_json', side_effect=cancelling_renderer), \
                    redirect_stdout(io.StringIO()) as out, redirect_stderr(io.StringIO()):
                self.assertEqual(cli.main([*self.base, '--format', 'json', *output]), 2)
                self.assertEqual(out.getvalue(), '')
            self.assertEqual(target.read_text(), 'before')
            self.assertEqual(list(self.repo.path.glob('.git-history-*')), [])

    def test_budget_cancellation_immediately_before_atomic_publication(self):
        target = self.repo.path / 'prior.txt'
        target.write_text('before', encoding='utf-8')
        cancel = threading.Event()
        original = cli.tempfile.NamedTemporaryFile

        def wrapped(*args, **kwargs):
            handle = original(*args, **kwargs)
            write = handle.write
            def cancelling_write(text):
                result = write(text)
                cancel.set()
                return result
            handle.write = cancelling_write
            return handle

        with work_budget(cancel=cancel), patch('git_history.cli.tempfile.NamedTemporaryFile',
                                               side_effect=wrapped):
            with self.assertRaises(WorkCancelled):
                cli.write_report(target, 'after', str(self.repo.path), force=True)
        self.assertEqual(target.read_text(), 'before')
        self.assertEqual(list(self.repo.path.glob('.git-history-*')), [])


if __name__ == '__main__':
    unittest.main()
