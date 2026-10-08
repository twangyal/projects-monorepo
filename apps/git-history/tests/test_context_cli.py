import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from tests.helpers import Repository
from tests.test_context import entry
from tests.test_report import Links

APP = Path(__file__).resolve().parents[1]


class ContextCliTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.addCleanup(self.repo.close)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'supplied context.json'
        self.output = Path(self.temp.name) / 'report.html'
        self.file = 'sample.py'
        self.repo.write(self.file, 'def answer():\n    return 1\n')
        self.original = self.repo.commit('Original answer')
        self.repo.write(self.file, 'def answer():\n    return 2\n')
        self.revision = self.repo.commit('Correct answer')

    def save(self, records):
        self.path.write_text(json.dumps({'schema_version': 1, 'entries': records}), encoding='utf-8')

    def cli(self, *arguments, function=False):
        selection = ['--function', 'answer'] if function else ['--lines', '1:2']
        return subprocess.run([sys.executable, '-m', 'git_history', 'explain', '--repo', str(self.repo.path),
                               '--file', self.file, *selection, *arguments], cwd=APP,
                              capture_output=True, text=True, timeout=30)

    def test_context_import_adds_only_supplied_section_and_preserves_repository(self):
        baseline = self.cli('--format', 'json')
        self.assertEqual(baseline.returncode, 0, baseline.stderr)
        self.save([entry(commit=self.original), entry(commit=self.revision,
                   source='Issue discussion', url='https://gitlab.com/group/repo/-/issues/7#note_2')])
        before = self.repo.git('status', '--porcelain')
        result = self.cli('--format', 'json', '--context', str(self.path))
        self.assertEqual(result.returncode, 0, result.stderr)
        imported = json.loads(result.stdout)
        supplied = imported.pop('supplied_context')
        self.assertEqual(imported, json.loads(baseline.stdout))
        self.assertEqual([item['commit'] for item in supplied['entries']], [self.original, self.revision])
        self.assertIn('Unverified', supplied['provenance'])
        self.assertEqual(self.repo.git('status', '--porcelain'), before)
        function = self.cli('--context', str(self.path), '--format', 'json', function=True)
        self.assertEqual(function.returncode, 0, function.stderr)
        self.assertEqual(json.loads(function.stdout)['selected_function'], 'answer')

    def test_html_excerpts_are_literal_and_all_context_anchors_resolve(self):
        self.save([entry(commit=self.revision, source='<img src=x onerror=alert(1)>',
                         author='<Author>', excerpt='Reason: "quotes" & <script>bad()</script>\nSecond line')])
        result = self.cli('--context', str(self.path), '--output', str(self.output))
        self.assertEqual(result.returncode, 0, result.stderr)
        html = self.output.read_text()
        parsed = Links()
        parsed.feed(html)
        self.assertNotIn('script', parsed.tags)
        self.assertNotIn('img', parsed.tags)
        self.assertIn('&lt;Author&gt;', html)
        self.assertIn('&lt;script&gt;', html)
        self.assertIn('Unverified supplied context', html)
        self.assertIn("default-src 'none'", html)
        self.assertEqual(len(parsed.ids), len(set(parsed.ids)))
        for link in parsed.links:
            if link.startswith('#'):
                self.assertIn(link[1:], parsed.ids)

    def test_stale_ref_and_unrelated_existing_commit_fail_without_publication(self):
        self.save([entry(commit=self.revision)])
        stale = self.cli('--context', str(self.path), '--ref', self.original, '--output', str(self.output))
        self.assertEqual(stale.returncode, 2, stale.stderr)
        self.assertEqual(stale.stdout, '')
        self.assertIn('not represented', stale.stderr)
        self.assertFalse(self.output.exists())
        self.repo.git('checkout', '-qb', 'unrelated', self.original)
        self.repo.write('other.txt', 'Another branch\n')
        unrelated = self.repo.commit('Unrelated evidence')
        self.repo.git('checkout', '-q', 'main')
        self.save([entry(commit=self.revision), entry(commit=unrelated)])
        self.output.write_text('Keep existing report')
        result = self.cli('--context', str(self.path), '--output', str(self.output), '--force')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertIn('not represented', result.stderr)
        self.assertNotIn('Traceback', result.stderr)
        self.assertEqual(self.output.read_text(), 'Keep existing report')

    def test_revision_only_and_rename_only_context_links_real_evidence(self):
        self.repo.git('mv', 'sample.py', 'renamed.py')
        renamed = self.repo.commit('Rename only')
        self.file = 'renamed.py'
        self.repo.write('unrelated.txt', 'New revision, unchanged source\n')
        head = self.repo.commit('Touch another file')
        baseline = json.loads(self.cli('--format', 'json').stdout)
        self.assertNotIn(renamed, {item['commit'] for item in baseline['blame'] + baseline['changes']})
        self.assertIn(renamed, {item['commit'] for item in baseline['renames']})
        self.save([entry(commit=head), entry(commit=renamed)])
        result = self.cli('--context', str(self.path))
        self.assertEqual(result.returncode, 0, result.stderr)
        parsed = Links()
        parsed.feed(result.stdout)
        self.assertEqual(parsed.ids.count('commit-' + head), 1)
        self.assertEqual(parsed.ids.count('commit-' + renamed), 1)

    def test_malformed_oversized_unsafe_input_never_replaces_existing_output(self):
        valid = entry(commit=self.revision)
        invalid = [b'PRIVATE_CONTEXT_SENTINEL', b' ' * (256 * 1024 + 1),
                   json.dumps({'schema_version': 2, 'entries': []}).encode(),
                   json.dumps({'schema_version': 1, 'entries': [valid] * 51}).encode(),
                   json.dumps({'schema_version': 1, 'entries': [{**valid, 'commit': self.revision[:10]}]}).encode(),
                   json.dumps({'schema_version': 1, 'entries': [{**valid, 'url': 'https://PRIVATE_CONTEXT_SENTINEL@github.com/a/b/pull/1'}]}).encode()]
        self.output.write_text('Keep existing report')
        for payload in invalid:
            with self.subTest(size=len(payload)):
                self.path.write_bytes(payload)
                result = self.cli('--context', str(self.path), '--output', str(self.output), '--force')
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertEqual(result.stdout, '')
                self.assertNotIn('PRIVATE_CONTEXT_SENTINEL', result.stderr)
                self.assertNotIn('Traceback', result.stderr)
                self.assertEqual(self.output.read_text(), 'Keep existing report')


if __name__ == '__main__':
    unittest.main()
