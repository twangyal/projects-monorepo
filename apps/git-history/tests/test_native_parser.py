"""Native isolation/protocol tests use real bounded children, without grammars."""
from __future__ import annotations

import json
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from git_history import native_parser
from git_history.model import FunctionDefinition
from git_history.native_protocol import MAX_SOURCE_BYTES, MAX_QUALIFIED_NAME_BYTES

AVAILABLE = all(importlib.util.find_spec(name) is not None for name in
                ('tree_sitter', 'tree_sitter_javascript', 'tree_sitter_typescript'))

if os.environ.get('GIT_HISTORY_REQUIRE_JAVASCRIPT') == '1' and not AVAILABLE:
    raise RuntimeError('Mandatory native parser tests require the optional packages.')


@unittest.skipUnless(os.name == 'posix', 'Native parsing requires POSIX isolation')
class NativeParserTests(unittest.TestCase):
    def setUp(self):
        self.children = []
        self.original_popen = subprocess.Popen

    def run_reply(self, raw: bytes, source: str = 'function exact() {}\n'):
        if len(raw) > 65536:
            with tempfile.TemporaryDirectory() as directory:
                fixture = Path(directory) / 'reply.json'
                fixture.write_bytes(raw)
                return self.run_script(f'import sys;from pathlib import Path;sys.stdin.buffer.read();sys.stdout.buffer.write(Path({str(fixture)!r}).read_bytes())', source)
        script = f'import sys; sys.stdin.buffer.read(); sys.stdout.buffer.write({raw!r})'
        return self.run_script(script, source)

    def run_script(self, script: str, source: str = 'function exact() {}\n'):
        def child(argv, **kwargs):
            self.assertEqual(argv[:3], [sys.executable, '-I', '-B'])
            self.assertEqual(Path(argv[3]).name, 'native_worker.py')
            self.assertEqual(argv[4:], ['javascript'])
            self.assertEqual(Path(kwargs['cwd']).resolve(), Path(native_parser.__file__).resolve().parent.parent)
            self.assertTrue(kwargs['start_new_session'])
            process = self.original_popen([sys.executable, '-I', '-B', '-c', script], **kwargs)
            self.children.append(process)
            return process
        with patch.object(native_parser.subprocess, 'Popen', side_effect=child):
            return native_parser.parse_native_functions(source, 'javascript')

    def assert_reaped(self):
        self.assertTrue(self.children)
        for child in self.children:
            self.assertIsNotNone(child.returncode)
            with self.assertRaises(ChildProcessError):
                os.waitpid(child.pid, os.WNOHANG)

    def test_exact_reply_returns_existing_contract_and_preserves_duplicates(self):
        item = {'qualified_name': r'outer.\u0061', 'start_line': 1, 'end_line': 2, 'kind': 'async function'}
        result = self.run_reply(json.dumps({'functions': [item, item]}).encode(), '\ufeffconst a = async () => {\r\n};\n')
        self.assertEqual(result, [FunctionDefinition(r'outer.\u0061', 1, 2, 'async function')] * 2)
        self.assert_reaped()

    def test_nonblocking_writes_drain_stderr_before_child_reads_large_stdin(self):
        script = "import os,sys,json; os.write(2,b'private native diagnostics'*20000); data=sys.stdin.buffer.read(); print(json.dumps({'functions':[]})); assert len(data)==524288"
        self.assertEqual(self.run_script(script, ' ' * MAX_SOURCE_BYTES), [])
        self.assert_reaped()

    def test_invalid_source_is_rejected_without_starting_a_child(self):
        for source in ['x' * (MAX_SOURCE_BYTES + 1), '\ud800', 'secret\0source', '\u00e9' * (MAX_SOURCE_BYTES // 2 + 1)]:
            with self.subTest(source_length=len(source)), patch.object(native_parser.subprocess, 'Popen') as popen:
                with self.assertRaisesRegex(native_parser.NativeParserError, '--lines'):
                    native_parser.parse_native_functions(source, 'javascript')
                popen.assert_not_called()

    def test_unknown_language_and_unsupported_platform_do_not_run_unbounded(self):
        with patch.object(native_parser.subprocess, 'Popen') as popen:
            with self.assertRaisesRegex(native_parser.NativeParserError, '--lines'):
                native_parser.parse_native_functions('', 'python')
            with patch.object(native_parser.os, 'name', 'nt'):
                with self.assertRaisesRegex(native_parser.NativeParserError, 'POSIX|isolation'):
                    native_parser.parse_native_functions('', 'javascript')
            popen.assert_not_called()

    def test_error_codes_are_actionable_and_never_include_private_source_or_stderr(self):
        for code in ['dependencies', 'syntax', 'complexity', 'unsupported']:
            with self.subTest(code=code):
                script = f'import sys; sys.stdin.buffer.read(); sys.stderr.write("secret native diagnostics"); print({json.dumps({"error":code})!r})'
                with self.assertRaisesRegex(native_parser.NativeParserError, '--lines') as caught:
                    self.run_script(script, 'secret committed source')
                self.assertNotIn('secret', str(caught.exception))
                if code == 'dependencies':
                    self.assertIn('[javascript]', str(caught.exception))
        self.assert_reaped()

    def test_strict_protocol_rejects_bad_json_unknown_fields_and_bool_coordinates(self):
        item = {'qualified_name': 'exact', 'start_line': 1, 'end_line': 1, 'kind': 'function'}
        invalid = [b'', b'\xff', b'{}', b'[]', b'{"functions":[],"functions":[]}', b'{"functions":[]} {}',
                   b'{"error":"secret source"}', b'{"error":"syntax","functions":[]}',
                   b'{"functions":NaN}', b'{"functions":[{"qualified_name":"\\ud800","start_line":1,"end_line":1,"kind":"function"}]}']
        for changed in [{'extra': True}, {'start_line': True}, {'end_line': 1.0}, {'kind': 'method'},
                        {'start_line': 0}, {'end_line': 2}, {'qualified_name': ''}, {'qualified_name': 'bad\0name'}]:
            invalid.append(json.dumps({'functions': [{**item, **changed}]}).encode())
        invalid.append(json.dumps({'functions': [{**item, 'start_line': 2, 'end_line': 1}]}).encode())
        for raw in invalid:
            with self.subTest(raw_prefix=raw[:40]):
                with self.assertRaisesRegex(native_parser.NativeParserError, 'reply|protocol') as caught:
                    self.run_reply(raw)
                self.assertNotIn('secret source', str(caught.exception))
        self.assert_reaped()

    def test_catalog_count_and_total_utf8_name_bytes_are_bounded(self):
        item = {'qualified_name': 'é', 'start_line': 1, 'end_line': 1, 'kind': 'function'}
        for functions in [[item] * 10001, [{**item, 'qualified_name': 'é' * (MAX_QUALIFIED_NAME_BYTES // 2 + 1)}]]:
            with self.assertRaisesRegex(native_parser.NativeParserError, 'reply|protocol|catalog'):
                self.run_reply(json.dumps({'functions': functions}, ensure_ascii=False).encode())
        self.assert_reaped()

    def test_only_lf_counts_towards_original_physical_coordinates(self):
        item = {'qualified_name': 'exact', 'start_line': 1, 'end_line': 1, 'kind': 'function'}
        self.assertEqual(self.run_reply(json.dumps({'functions': [item]}).encode(), '\ufefffunction exact() {\u2028}\r'), [FunctionDefinition('exact', 1, 1, 'function')])
        with self.assertRaises(native_parser.NativeParserError):
            self.run_reply(json.dumps({'functions': [{**item, 'end_line': 2}]}).encode(), 'function exact() {}\n')

    def test_combined_output_bound_kills_and_reaps_stdout_and_stderr_producers(self):
        for fd in [1, 2]:
            with patch.object(native_parser, 'MAX_OUTPUT_BYTES', 1024):
                with self.assertRaisesRegex(native_parser.NativeParserError, 'output|limit') as caught:
                    self.run_script(f'import os;\nwhile True: os.write({fd},b"private data"*1000)')
                self.assertNotIn('private data', str(caught.exception))
        self.assert_reaped()

    def test_exact_combined_budget_is_allowed_and_one_extra_stderr_byte_fails(self):
        stdout = b'{"functions":[]}' + b' ' * (512 - len(b'{"functions":[]}'))
        for stderr_bytes in [512, 513]:
            script = f'import os,sys;sys.stdin.buffer.read();os.write(1,{stdout!r});os.write(2,b"e"*{stderr_bytes})'
            with patch.object(native_parser, 'MAX_OUTPUT_BYTES', 1024):
                if stderr_bytes == 512:
                    self.assertEqual(self.run_script(script), [])
                else:
                    with self.assertRaisesRegex(native_parser.NativeParserError, 'combined output'):
                        self.run_script(script)
        self.assert_reaped()

    def test_timeout_after_closed_pipes_kills_and_reaps_the_child(self):
        started = time.monotonic()
        with patch.object(native_parser, 'WALL_SECONDS', .1):
            with self.assertRaisesRegex(native_parser.NativeParserError, 'time|deadline'):
                self.run_script('import os,time;os.close(0);os.close(1);os.close(2);time.sleep(30)', '')
        self.assertLess(time.monotonic() - started, 2)
        self.assert_reaped()

    def test_nonzero_exit_and_launch_failure_never_echo_native_diagnostics(self):
        with self.assertRaises(native_parser.NativeParserError) as caught:
            self.run_script('import sys;sys.stderr.write("private native diagnostics");sys.exit(7)')
        self.assertNotIn('private', str(caught.exception))
        self.assert_reaped()
        with patch.object(native_parser.subprocess, 'Popen', side_effect=OSError('private filesystem path')):
            with self.assertRaises(native_parser.NativeParserError) as caught:
                native_parser.parse_native_functions('', 'javascript')
        self.assertNotIn('private', str(caught.exception))

    def test_caller_interruptions_propagate_after_reaping(self):
        for error in [KeyboardInterrupt, SystemExit]:
            with patch.object(native_parser.selectors.DefaultSelector, 'select', side_effect=error):
                with self.assertRaises(error):
                    self.run_script('import time;time.sleep(30)')
        self.assert_reaped()

    @unittest.skipUnless(hasattr(os, 'fork'), 'POSIX process groups')
    def test_timeout_kills_descendants_holding_pipes_after_parent_exits(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'escaped'
            script = f'import os,time;from pathlib import Path;pid=os.fork();\nif pid==0: time.sleep(.5);Path({str(marker)!r}).write_text("escaped")\nelse: os._exit(0)'
            with patch.object(native_parser, 'WALL_SECONDS', .1):
                with self.assertRaisesRegex(native_parser.NativeParserError, 'time|deadline'):
                    self.run_script(script)
            time.sleep(.55)
            self.assertFalse(marker.exists())
        self.assert_reaped()


@unittest.skipUnless(os.name == 'posix', 'Native parsing requires POSIX isolation')
class NativeWorkerTests(unittest.TestCase):
    def worker(self, source: bytes, language='javascript', *, environment=None):
        entry = Path(native_parser.__file__).resolve().with_name('native_worker.py')
        result = subprocess.run([sys.executable, '-I', '-B', str(entry), language],
                                input=source, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env=environment, cwd=entry.parent.parent, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr[:100])
        return json.loads(result.stdout)

    def test_worker_rejects_invalid_utf8_nul_oversize_and_language_before_grammar(self):
        for source, language, code in [(b'\xff', 'javascript', 'syntax'),
                                       (b'\0', 'javascript', 'syntax'),
                                       (b'x' * (MAX_SOURCE_BYTES + 1), 'javascript', 'complexity'),
                                       (b'', 'python', 'unsupported')]:
            with self.subTest(code=code):
                self.assertEqual(self.worker(source, language), {'error': code})

    def test_worker_limits_precede_native_import_and_no_inspected_path_is_imported(self):
        # Use a disposable *trusted application* fixture. Its syntax module
        # reports unsupported unless every bound was installed before import.
        with tempfile.TemporaryDirectory() as directory:
            package = Path(directory) / 'git_history'
            package.mkdir()
            trusted = Path(native_parser.__file__).resolve().parent
            for name in ['native_worker.py', 'native_protocol.py', 'model.py']:
                (package / name).write_bytes((trusted / name).read_bytes())
            (package / '__init__.py').write_text('')
            (package / 'native_syntax.py').write_text('import resource\nfrom .native_protocol import ADDRESS_SPACE_BYTES,CPU_SECONDS\nassert resource.getrlimit(resource.RLIMIT_AS)==(ADDRESS_SPACE_BYTES,ADDRESS_SPACE_BYTES)\nassert resource.getrlimit(resource.RLIMIT_CPU)==CPU_SECONDS\nassert resource.getrlimit(resource.RLIMIT_CORE)==(0,0)\nassert resource.getrlimit(resource.RLIMIT_FSIZE)==(0,0)\nclass NativeSyntaxError(ValueError):\n def __init__(self,code): self.code=code\ndef parse_native(source,language): return []\n')
            poison = Path(directory) / 'inspected'
            poison.mkdir()
            (poison / 'git_history.py').write_text('raise RuntimeError("Inspected code executed")')
            (poison / 'sitecustomize.py').write_text('raise RuntimeError("Inspected configuration executed")')
            env = {**os.environ, 'PYTHONPATH': str(poison)}
            result = subprocess.run([sys.executable, '-I', '-B', str(package / 'native_worker.py'), 'javascript'],
                                    input=b'function safe() {}', stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, cwd=poison, env=env, timeout=5)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(json.loads(result.stdout), {'functions': []})
            self.assertFalse(any(package.rglob('__pycache__')))

    @unittest.skipUnless(AVAILABLE, 'optional native packages not installed')
    def test_parent_loads_no_native_extensions_when_actual_worker_parses(self):
        script = 'import sys;from git_history.native_parser import parse_native_functions;f=parse_native_functions("function safe() {}", "javascript");assert len(f)==1 and f[0].qualified_name=="safe";assert not any(name.startswith("tree_sitter") or name=="git_history.native_syntax" for name in sys.modules)'
        completed = subprocess.run([sys.executable, '-B', '-c', script], cwd=Path(native_parser.__file__).resolve().parent.parent,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=6)
        self.assertEqual(completed.returncode, 0, completed.stderr[:500])

    @unittest.skipIf(AVAILABLE, 'requires dependency-free environment')
    def test_missing_packages_are_reported_without_native_stderr(self):
        self.assertEqual(self.worker(b'function safe() {}'), {'error': 'dependencies'})


if __name__ == '__main__':
    unittest.main()
