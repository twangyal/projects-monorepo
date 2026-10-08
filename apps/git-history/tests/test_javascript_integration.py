"""Optional syntax integration without native imports in the CLI process."""
from contextlib import redirect_stderr, redirect_stdout
import importlib.metadata
import io
import os
import sys
import types
import unittest
from unittest.mock import patch

from git_history.cli import main
from git_history.function_parser import FunctionParseError, parse_functions
from git_history.model import FunctionDefinition
from git_history.native_protocol import SUFFIX_LANGUAGES
from git_history.reader import ReaderError, inspect_repository, list_functions
from tests.helpers import Repository


class NativeFixtureError(ValueError):
    pass


def fixture_module(callback):
    module = types.ModuleType('git_history.native_parser')
    module.NativeParserError = NativeFixtureError
    module.parse_native_functions = callback
    return module


class JavascriptDispatchTests(unittest.TestCase):
    def test_every_suffix_dispatches_exact_original_text_to_fixed_language(self):
        source = '\ufeffconst f = () => 1;\r\n// logical separator\u2028\r'
        expected = [FunctionDefinition('f', 1, 1, 'function')]
        calls = []
        def parse(value, language):
            calls.append((value, language))
            return expected
        with patch.dict(sys.modules, {'git_history.native_parser': fixture_module(parse)}):
            for suffix, language in {**SUFFIX_LANGUAGES, '.d.ts': 'typescript'}.items():
                with self.subTest(suffix=suffix):
                    self.assertEqual(parse_functions(source, f'nested/file{suffix}'), expected)
                    self.assertEqual(calls[-1], (source, language))
        self.assertEqual(len(calls), len(SUFFIX_LANGUAGES) + 1)

    def test_native_errors_become_existing_function_and_reader_errors(self):
        def unavailable(_source, _language):
            raise NativeFixtureError('Install optional JavaScript support or use --lines.')
        with patch.dict(sys.modules, {'git_history.native_parser': fixture_module(unavailable)}):
            with self.assertRaisesRegex(FunctionParseError, 'optional JavaScript.*--lines'):
                parse_functions('function f() {}', 'file.js')
            repo = Repository()
            self.addCleanup(repo.close)
            repo.write('file.js', 'function f() {}\n')
            repo.commit()
            with self.assertRaisesRegex(ReaderError, 'optional JavaScript.*--lines'):
                list_functions(repo.path, 'file.js')

    def test_python_and_manual_selection_do_not_touch_native_dispatch(self):
        def forbidden(*_args):
            self.fail('Core behavior attempted optional native parsing')
        repo = Repository()
        self.addCleanup(repo.close)
        repo.write('file.js', 'function f() {}\n')
        repo.commit()
        with patch.dict(sys.modules, {'git_history.native_parser': fixture_module(forbidden)}):
            self.assertEqual(parse_functions('def f(): pass\n', 'file.py')[0].qualified_name, 'f')
            self.assertEqual(parse_functions('def f(): ...\n', 'file.pyi')[0].qualified_name, 'f')
            self.assertEqual(inspect_repository(repo.path, 'file.js', 1, 1).source, 'function f() {}\n')
            with self.assertRaisesRegex(FunctionParseError, '--lines'):
                parse_functions('function f() {}', 'file.JS')

    def test_help_describes_optional_languages_without_python_only_selector(self):
        for command in ['functions', 'explain']:
            output = io.StringIO()
            with redirect_stdout(output), self.assertRaises(SystemExit) as exit_result:
                main([command, '--help'])
            self.assertEqual(exit_result.exception.code, 0)
            self.assertIn('JavaScript', output.getvalue())
            self.assertIn('TypeScript', output.getvalue())
            self.assertNotIn('Exact Python function', output.getvalue())

    def test_parser_failure_leaves_stdout_and_existing_output_untouched(self):
        repo = Repository()
        self.addCleanup(repo.close)
        repo.write('file.ts', 'function f() {}\n')
        repo.commit()
        target = repo.path / 'report.html'
        target.write_text('Existing report', encoding='utf-8')
        def invalid(_source, _language):
            raise NativeFixtureError('Cannot parse committed TypeScript; use --lines.')
        for command in [('functions',), ('explain', '--function', 'f', '--force', '--output', str(target))]:
            output, errors = io.StringIO(), io.StringIO()
            with patch.dict(sys.modules, {'git_history.native_parser': fixture_module(invalid)}):
                with redirect_stdout(output), redirect_stderr(errors):
                    result = main([*command, '--repo', str(repo.path), '--file', 'file.ts'])
            self.assertEqual(result, 2)
            self.assertEqual(output.getvalue(), '')
            self.assertIn('--lines', errors.getvalue())
            self.assertEqual(target.read_text(), 'Existing report')


def native_available():
    try:
        for name in ['tree-sitter', 'tree-sitter-javascript', 'tree-sitter-typescript']:
            importlib.metadata.version(name)
        return True
    except importlib.metadata.PackageNotFoundError:
        return False


class InstalledJavascriptIntegrationTests(unittest.TestCase):
    def setUp(self):
        if not native_available():
            if os.environ.get('GIT_HISTORY_REQUIRE_JAVASCRIPT') == '1':
                self.fail('Optional JavaScript dependencies are required for this verification run.')
            self.skipTest('Optional JavaScript grammar packages are not installed.')
        self.repo = Repository()
        self.addCleanup(self.repo.close)

    def test_all_extension_families_select_actual_committed_functions(self):
        native_before = {name for name in sys.modules if name.startswith('tree_sitter')}
        for suffix in SUFFIX_LANGUAGES:
            with self.subTest(suffix=suffix):
                value = '<span>hello</span>' if suffix in {'.jsx', '.tsx'} else '42'
                source = f'export function answer() {{\n  return {value};\n}}\n'
                file = f'fixture{suffix}'
                self.repo.write(file, source)
                revision = self.repo.commit()
                catalog = list_functions(self.repo.path, file)
                self.assertEqual(catalog.revision, revision)
                self.assertEqual(catalog.functions, [FunctionDefinition('answer', 1, 3, 'function')])
                selected = inspect_repository(self.repo.path, file, function='answer')
                manual = inspect_repository(self.repo.path, file, 1, 3)
                self.assertEqual(selected.selected_function, 'answer')
                selected.selected_function = None
                self.assertEqual(selected, manual)
                self.assertEqual({name for name in sys.modules if name.startswith('tree_sitter')}, native_before)

    def test_declaration_only_typescript_has_empty_catalog_and_manual_fallback(self):
        source = ('export declare function declared(value: string): number;\n'
                  'interface Shape { method(): void; }\n'
                  'declare const callback: () => void;\n')
        self.repo.write('types.d.ts', source)
        self.repo.commit()
        self.assertEqual(list_functions(self.repo.path, 'types.d.ts').functions, [])
        self.assertEqual(inspect_repository(self.repo.path, 'types.d.ts', 1, 3).source, source)
        with self.assertRaisesRegex(ReaderError, 'No function'):
            inspect_repository(self.repo.path, 'types.d.ts', function='declared')
