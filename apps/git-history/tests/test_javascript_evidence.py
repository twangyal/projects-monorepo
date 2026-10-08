"""Independent committed fixtures and real CLI/Git evidence, never parser oracles."""
from dataclasses import asdict
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from git_history import reader
from tests.helpers import Repository


FIXTURES = Path(__file__).parent / 'fixtures' / 'javascript'
APP = Path(__file__).resolve().parents[1]
NATIVE_PACKAGES = ('tree-sitter', 'tree-sitter-javascript', 'tree-sitter-typescript')


def missing_native_packages():
    missing = []
    for package in NATIVE_PACKAGES:
        try:
            importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            missing.append(package)
    return missing


MISSING_NATIVE = missing_native_packages()


class RealEvidenceBase(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.addCleanup(self.repo.close)

    def fixture(self, name, path=None):
        content = (FIXTURES / name).read_bytes()
        self.repo.write(path or name, content)
        return content, self.repo.commit(f'Original authored fixture {name}')

    def cli(self, *arguments):
        return subprocess.run([sys.executable, '-B', '-m', 'git_history', *arguments,
                               '--repo', str(self.repo.path)], cwd=APP,
                              capture_output=True, text=True, timeout=15)


class CoreJavascriptEvidenceTests(RealEvidenceBase):
    def test_optional_ci_cannot_silently_skip_its_native_gate(self):
        if os.environ.get('GIT_HISTORY_REQUIRE_JAVASCRIPT') == '1':
            self.assertEqual(MISSING_NATIVE, [], 'Optional CI must install the javascript extra.')

    def test_manual_javascript_cli_evidence_needs_no_native_parser(self):
        _, revision = self.fixture('history.js')
        result = self.cli('explain', '--file', 'history.js', '--lines', '14:16', '--format', 'json')
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report['revision'], revision)
        self.assertIsNone(report['selected_function'])
        self.assertEqual(report['source'], '      load: (value) => {\n        return value + 1;\n      },\n')
        self.assertEqual([line['final_line'] for line in report['blame']], [14, 15, 16])
        self.assertEqual({line['commit'] for line in report['blame']}, {revision})


@unittest.skipIf(bool(MISSING_NATIVE),
                 'Native JavaScript evidence requires optional distributions: '
                 + ', '.join(MISSING_NATIVE))
class NativeJavascriptEvidenceTests(RealEvidenceBase):
    def test_authored_javascript_names_ranges_and_barriers_are_exact(self):
        _, revision = self.fixture('history.js', 'source/space é.mjs')
        catalog = reader.list_functions(self.repo.path, 'source/space é.mjs')
        self.assertEqual(catalog.revision, revision)
        self.assertEqual([(entry.qualified_name, entry.start_line, entry.end_line, entry.kind)
                          for entry in catalog.functions], [
            ('fetchRecord', 4, 9, 'async function'),
            ('fetchRecord.normalize', 5, 7, 'function'),
            ('api.nested.load', 14, 16, 'function'),
            ('api.save', 18, 20, 'function'),
            ('Bound.constructor', 24, 24, 'function'),
            ('Bound.refresh', 25, 27, 'async function'),
            ('Bound.compute', 28, 30, 'function'),
        ])
        report = reader.inspect_repository(self.repo.path, 'source/space é.mjs',
                                           function='api.nested.load')
        self.assertEqual((report.start_line, report.end_line), (14, 16))
        self.assertNotIn('const', report.source)

    def test_typescript_implementation_wrappers_decorators_and_ambiguity(self):
        self.fixture('annual.ts')
        catalog = reader.list_functions(self.repo.path, 'annual.ts')
        self.assertEqual([(entry.qualified_name, entry.start_line, entry.end_line, entry.kind)
                          for entry in catalog.functions], [
            ('measure', 5, 7, 'function'),
            ('wrapped', 10, 14, 'function'),
            ('Ledger.record', 17, 21, 'async function'),
            ('Ledger.amount', 22, 22, 'getter'),
            ('Ledger.amount', 23, 23, 'setter'),
            ('bound.method', 29, 29, 'function'),
        ])
        with self.assertRaisesRegex(reader.ReaderError, '[Aa]mbiguous') as caught:
            reader.inspect_repository(self.repo.path, 'annual.ts', function='Ledger.amount')
        self.assertIn('22:22', str(caught.exception))
        self.assertIn('23:23', str(caught.exception))
        manual = reader.inspect_repository(self.repo.path, 'annual.ts', 22, 22)
        self.assertEqual(manual.source, '  get amount() { return 1; }\n')

    def test_actual_tsx_cli_lists_only_named_supported_implementations(self):
        _, revision = self.fixture('view.tsx')
        result = self.cli('functions', '--file', 'view.tsx', '--format', 'json')
        self.assertEqual(result.returncode, 0, result.stderr)
        catalog = json.loads(result.stdout)
        self.assertEqual(catalog['revision'], revision)
        self.assertEqual(catalog['functions'], [
            dict(qualified_name='View', start_line=2, end_line=7, kind='function'),
            dict(qualified_name='View.label', start_line=3, end_line=5, kind='function'),
        ])

    def test_renamed_path_and_changed_body_keep_real_original_line_evidence(self):
        old_path, new_path = 'old/helper.js', 'new/space helper.js'
        original, first = self.fixture('history.js', old_path)
        changed = original.replace(b'return value + 1;', b'return value + 2;', 1)
        self.repo.write(old_path, changed)
        second = self.repo.commit('Correct the returned fixture value')
        (self.repo.path / 'new').mkdir()
        self.repo.git('mv', old_path, new_path)
        renamed = self.repo.commit('Move fixture without changing its source')
        report = reader.inspect_repository(self.repo.path, new_path, function='api.nested.load')
        self.assertEqual(report.revision, renamed)
        self.assertEqual(report.source, '      load: (value) => {\n        return value + 2;\n      },\n')
        self.assertEqual([line.commit for line in report.blame], [first, second, first])
        self.assertEqual([line.path for line in report.blame], [old_path] * 3)
        self.assertEqual([line.original_line for line in report.blame], [14, 15, 16])
        self.assertTrue(any(item.commit == second and 'return value + 2;' in item.patch
                            and 'Correct the returned fixture value' in item.message
                            for item in report.changes))
        self.assertEqual([(item.commit, item.old_path, item.new_path, item.similarity)
                          for item in report.renames], [(renamed, old_path, new_path, 100)])
        manual = reader.inspect_repository(self.repo.path, new_path, 14, 16)
        report.selected_function = None
        self.assertEqual(report, manual)

    def test_committed_source_ignores_invalid_dirty_worktree_and_never_executes(self):
        _, revision = self.fixture('history.js')
        self.repo.write('history.js', 'BROKEN PRIVATE_WORKTREE_MARKER {{{\n')
        self.repo.write('package.json', '{"scripts":{"parser":"touch parser-executed"}}')
        report = reader.inspect_repository(self.repo.path, 'history.js', function='fetchRecord')
        self.assertEqual(report.revision, revision)
        self.assertEqual((report.start_line, report.end_line), (4, 9))
        self.assertIn('return normalize(id);', report.source)
        self.assertNotIn('PRIVATE_WORKTREE_MARKER', report.source)
        self.assertFalse((self.repo.path / 'parser-executed').exists())

    def test_function_and_evidence_keep_once_resolved_commit_when_ref_moves(self):
        _, revision = self.fixture('history.js')
        actual_run, resolutions = reader.GitRunner.run, []

        def move_branch(instance, *args, **kwargs):
            result = actual_run(instance, *args, **kwargs)
            if 'rev-parse' in args and '--verify' in args:
                resolutions.append(result)
                self.repo.write('history.js', 'export function replacement() { return 99; }\n')
                self.repo.commit('Move main after actual resolution')
            return result

        with patch.object(reader.GitRunner, 'run', move_branch):
            report = reader.inspect_repository(self.repo.path, 'history.js', function='fetchRecord')
        self.assertEqual(len(resolutions), 1)
        self.assertEqual(report.revision, revision)
        self.assertEqual(report.selected_function, 'fetchRecord')
        self.assertEqual({line.commit for line in report.blame}, {revision})
        self.assertEqual(report.changes[0].commit, revision)
        self.assertNotIn('replacement', report.source)

    def test_original_utf8_bom_crlf_and_unicode_separators_use_only_lf_coordinates(self):
        source = ('\ufeffconst café = 1;\u2028export function chosen() {\r\n'
                  '  return café;\r\n}\r\n')
        self.repo.write('physical.ts', source)
        self.repo.commit('Original physical UTF-8 line endings')
        catalog = reader.list_functions(self.repo.path, 'physical.ts')
        self.assertEqual([(entry.qualified_name, entry.start_line, entry.end_line)
                          for entry in catalog.functions], [('chosen', 1, 3)])
        report = reader.inspect_repository(self.repo.path, 'physical.ts', function='chosen')
        self.assertEqual(report.source, source)
        self.assertEqual([line.final_line for line in report.blame], [1, 2, 3])
        self.assertEqual(report.blame[0].content, '\ufeffconst café = 1;\u2028export function chosen() {\r')

    def test_actual_cli_json_html_escape_literal_source_and_anchor_evidence(self):
        _, revision = self.fixture('history.js')
        common = ['explain', '--file', 'history.js', '--function', 'api.save']
        result = self.cli(*common, '--format', 'json')
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report['revision'], revision)
        self.assertEqual(report['selected_function'], 'api.save')
        self.assertEqual((report['start_line'], report['end_line']), (18, 20))
        self.assertIn('<script>literal evidence</script>', report['source'])
        output = self.repo.path.parent / f'{self.repo.path.name}-javascript.html'
        self.addCleanup(output.unlink, missing_ok=True)
        result = self.cli(*common, '--output', str(output))
        self.assertEqual(result.returncode, 0, result.stderr)
        html = output.read_text('utf-8')
        self.assertIn('api.save', html)
        self.assertIn('&lt;script&gt;literal evidence&lt;/script&gt;', html)
        self.assertNotIn('<script>literal evidence</script>', html)
        self.assertIn(f'id="commit-{revision}"', html)
        self.assertIn('href="#source-L19"', html)
        self.assertIn('id="source-L19"', html)

    def test_large_implementations_are_listed_but_explanation_keeps_200_line_limit(self):
        source = 'export function longSong() {\n' + '  consume();\n' * 200 + '}\n'
        self.repo.write('long.cts', source)
        self.repo.commit('A 202-line implementation')
        catalog = reader.list_functions(self.repo.path, 'long.cts')
        self.assertEqual([asdict(entry) for entry in catalog.functions], [
            dict(qualified_name='longSong', start_line=1, end_line=202, kind='function')])
        with self.assertRaisesRegex(reader.ReaderError, '200'):
            reader.inspect_repository(self.repo.path, 'long.cts', function='longSong')
        report = reader.inspect_repository(self.repo.path, 'long.cts', 199, 202)
        self.assertEqual(report.source, '  consume();\n' * 3 + '}\n')


if __name__ == '__main__':
    unittest.main()
