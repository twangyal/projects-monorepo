"""Aggregate cancellation must remain distinct from recoverable Git failures."""
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch

from git_history.work_budget import (
    WorkCancelled, WorkDeadlineExceeded, check_work_budget, current_work_budget,
    work_budget,
)
from git_history.runner import GitError, _run_bounded


class WorkBudgetTests(unittest.TestCase):
    def test_inert_outside_scope_and_restored_after_scope(self):
        self.assertIsNone(current_work_budget())
        check_work_budget()
        with work_budget(timeout=1) as budget:
            self.assertIs(current_work_budget(), budget)
            check_work_budget()
        self.assertIsNone(current_work_budget())

    def test_cancel_and_timeout_are_not_caught_as_git_or_value_errors(self):
        cancel = threading.Event()
        cancel.set()
        with work_budget(timeout=1, cancel=cancel):
            with self.assertRaises(WorkCancelled) as caught:
                check_work_budget()
        self.assertNotIsInstance(caught.exception, (GitError, ValueError))
        with work_budget(timeout=.001):
            time.sleep(.005)
            with self.assertRaises(WorkDeadlineExceeded):
                check_work_budget()

    def test_budget_context_does_not_leak_to_other_threads(self):
        seen = []
        with work_budget(timeout=1):
            thread = threading.Thread(target=lambda: seen.append(current_work_budget()))
            thread.start()
            thread.join()
        self.assertEqual(seen, [None])

    def test_invalid_timeouts_are_rejected(self):
        for timeout in [True, 0, -1, float('inf'), float('nan')]:
            with self.assertRaises(ValueError), work_budget(timeout=timeout):
                pass

    def test_pre_cancelled_budget_does_not_spawn_git(self):
        cancel = threading.Event()
        cancel.set()
        with work_budget(timeout=1, cancel=cancel), patch('git_history.runner.subprocess.Popen') as popen:
            with self.assertRaises(WorkCancelled):
                _run_bounded([sys.executable, '-c', 'pass'], cwd=Path.cwd(),
                             env=os.environ, timeout=10, max_bytes=1024)
            popen.assert_not_called()

    def test_cancel_after_pipe_eof_kills_and_reaps_real_child_promptly(self):
        original = subprocess.Popen
        children = []
        cancel = threading.Event()

        def launch(*args, **kwargs):
            child = original(*args, **kwargs)
            children.append(child)
            threading.Timer(.15, cancel.set).start()
            return child

        started = time.monotonic()
        with patch('git_history.runner.subprocess.Popen', side_effect=launch), work_budget(timeout=3, cancel=cancel):
            with self.assertRaises(WorkCancelled):
                _run_bounded([sys.executable, '-c', 'import os,time;os.close(1);os.close(2);time.sleep(30)'],
                             cwd=Path.cwd(), env=os.environ, timeout=10, max_bytes=1024)
        self.assertLess(time.monotonic() - started, 1)
        self.assertIsNotNone(children[0].returncode)
        with self.assertRaises(ChildProcessError):
            os.waitpid(children[0].pid, os.WNOHANG)

    def test_python_ast_is_isolated_only_when_budget_is_active(self):
        from git_history.function_parser import parse_functions
        from git_history import native_parser
        source = '@decorator\ndef original():\n    return 1\n'
        expected = parse_functions(source, 'source.py')
        original = subprocess.Popen
        calls = []

        def launch(argv, **kwargs):
            calls.append(argv)
            return original(argv, **kwargs)

        with patch.object(native_parser.subprocess, 'Popen', side_effect=launch), work_budget(timeout=2):
            self.assertEqual(parse_functions(source, 'source.py'), expected)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][-1], 'python-ast')
        self.assertEqual(calls[0][1:3], ['-I', '-B'])


if __name__ == '__main__':
    unittest.main()
