"""Discovery uses committed trees, not the working tree or source execution."""
from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
import unittest
from unittest.mock import patch

from git_history import reader
from git_history.cli import main
from tests.helpers import Repository


class FileDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.addCleanup(self.repo.close)

    def test_lists_supported_regular_committed_candidates_without_parsing(self):
        for path, value in [('src/a.py', 'def broken(:'), ('src/b.pyi', 'x: int'),
                            ('src/c.jsx', 'not valid syntax'), ('src/d.tsx', '<'),
                            ('src/e.mts', 'x'), ('README.md', '# doc'),
                            ('big.py', b'x' * (512 * 1024 + 1))]:
            self.repo.write(path, value)
        (self.repo.path / 'alias.py').symlink_to('src/a.py')
        sha = self.repo.commit()
        self.repo.write('src/a.py', 'uncommitted replacement')
        self.repo.write('new.py', 'untracked')
        before = self.repo.git('status', '--porcelain')
        index = (self.repo.path / '.git/index').read_bytes()
        with patch('git_history.function_parser.ast.parse', side_effect=AssertionError('parsed')):
            catalog = reader.list_files(self.repo.path)
        self.assertEqual(catalog.revision, sha)
        self.assertEqual([(f.path, f.language, f.size_bytes) for f in catalog.files], [
            ('src/a.py', 'python', 12), ('src/b.pyi', 'python', 6),
            ('src/c.jsx', 'javascript', 16), ('src/d.tsx', 'typescript', 1),
            ('src/e.mts', 'typescript', 1)])
        self.assertEqual(self.repo.git('status', '--porcelain'), before)
        self.assertEqual((self.repo.path / '.git/index').read_bytes(), index)

    def test_directory_filter_is_literal_exact_prefix_and_language_is_explicit(self):
        for path in ['src/a.py', 'src/nested/b.js', 'src-extra/c.py', ':magic/x.ts',
                     'space é/q.py', '-leading/end.cts']:
            self.repo.write(path, 'x')
        self.repo.commit()
        self.assertEqual([f.path for f in reader.list_files(self.repo.path, directory='src').files],
                         ['src/a.py', 'src/nested/b.js'])
        self.assertEqual([f.path for f in reader.list_files(self.repo.path, directory='src/', language='javascript').files],
                         ['src/nested/b.js'])
        for directory, expected in [(':magic', ':magic/x.ts'), ('space é', 'space é/q.py'),
                                    ('-leading', '-leading/end.cts')]:
            self.assertEqual([f.path for f in reader.list_files(self.repo.path, directory=directory).files], [expected])
        self.assertEqual(reader.list_files(self.repo.path, directory='missing').files, [])

    def test_invalid_filters_are_rejected_before_git_reads(self):
        for directory in ['../src', 'src/../other', '/tmp', '\\bad', 'C:\\bad', 'x\x00y', 1]:
            with self.subTest(directory=directory), self.assertRaises(reader.ReaderError):
                reader.list_files(self.repo.path, directory=directory)
        for language in ['ruby', None, 1]:
            with self.subTest(language=language), self.assertRaises(reader.ReaderError):
                reader.list_files(self.repo.path, language=language)

    def test_revision_is_resolved_once_even_if_ref_moves(self):
        self.repo.write('original.py', 'x')
        sha = self.repo.commit()
        run = reader.GitRunner.run
        def move(instance, *args, **kwargs):
            result = run(instance, *args, **kwargs)
            if 'rev-parse' in args and '--verify' in args:
                self.repo.write('later.py', 'y')
                self.repo.commit()
            return result
        with patch.object(reader.GitRunner, 'run', move):
            catalog = reader.list_files(self.repo.path)
        self.assertEqual(catalog.revision, sha)
        self.assertEqual([f.path for f in catalog.files], ['original.py'])

    def test_non_utf8_paths_are_omitted_with_disclosure(self):
        with open(os.fsencode(self.repo.path) + b'/bad-\xff.py', 'wb') as handle:
            handle.write(b'x')
        self.repo.write('good.py', 'x')
        self.repo.commit()
        catalog = reader.list_files(self.repo.path)
        self.assertEqual([f.path for f in catalog.files], ['good.py'])
        self.assertEqual(catalog.omitted_non_utf8_paths, 1)

    def test_cli_json_keeps_exact_paths_and_text_escapes_terminal_controls(self):
        filename = 'line\n\x1b[31m.py'
        self.repo.write(filename, 'x')
        sha = self.repo.commit()
        for format in ['json', 'text']:
            out, err = io.StringIO(), io.StringIO()
            with redirect_stdout(out), redirect_stderr(err):
                status = main(['files', '--repo', str(self.repo.path), '--format', format])
            self.assertEqual(status, 0, err.getvalue())
            self.assertNotIn('\x1b', out.getvalue())
            if format == 'json':
                data = json.loads(out.getvalue())
                self.assertEqual(data['revision'], sha)
                self.assertEqual(data['files'][0]['path'], filename)
            else:
                self.assertIn('\\n\\u001b[31m.py', out.getvalue())
                self.assertIn('candidate', out.getvalue().lower())

    def test_cli_empty_and_invalid_requests_are_actionable(self):
        self.repo.write('README.md', '# doc')
        self.repo.commit()
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            status = main(['files', '--repo', str(self.repo.path)])
        self.assertEqual(status, 0)
        self.assertIn('No', out.getvalue())
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            status = main(['files', '--repo', str(self.repo.path), '--directory', '../src'])
        self.assertEqual(status, 2)
        self.assertEqual(out.getvalue(), '')
        self.assertNotIn('Traceback', err.getvalue())

    def test_catalog_count_limit_rejects_partial_results_and_can_be_narrowed(self):
        for index in range(10_000):
            self.repo.write(f'many/item{index:05}.py', 'x')
        self.repo.commit()
        self.assertEqual(len(reader.list_files(self.repo.path).files), 10_000)
        self.repo.write('small/one.py', 'y')
        self.repo.commit()
        with self.assertRaisesRegex(reader.ReaderError, '10,000.*directory'):
            reader.list_files(self.repo.path)
        self.assertEqual([f.path for f in reader.list_files(self.repo.path, directory='small').files],
                         ['small/one.py'])

    def test_size_boundary_and_submodule_are_handled_without_object_reads(self):
        self.repo.write('exact.py', b'x' * (512 * 1024))
        self.repo.write('empty.js', '')
        sha = self.repo.commit()
        self.repo.git('update-index', '--add', '--cacheinfo', f'160000,{sha},module.py')
        self.repo.git('commit', '-qm', 'Add a submodule tree entry')
        self.assertEqual([(f.path, f.size_bytes) for f in reader.list_files(self.repo.path).files],
                         [('empty.js', 0), ('exact.py', 524288)])

    def test_all_parser_suffixes_and_immutable_old_revision_are_discoverable(self):
        for suffix in ['py', 'pyi', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'tsx']:
            self.repo.write('old.' + suffix, 'x')
        sha = self.repo.commit()
        self.repo.write('new.py', 'y')
        self.repo.commit()
        catalog = reader.list_files(self.repo.path, ref=sha, language='typescript')
        self.assertEqual([f.path for f in catalog.files],
                         ['old.cts', 'old.mts', 'old.ts', 'old.tsx'])
        self.assertEqual(catalog.revision, sha)
        self.assertEqual(len(reader.list_files(self.repo.path, ref=sha).files), 10)
