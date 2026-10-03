import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from git_history import reader
from tests.helpers import Repository


class ReaderTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.addCleanup(self.repo.close)

    def inspect(self, file='sample.txt', start=1, end=1, **kwargs):
        return reader.inspect_repository(self.repo.path, file, start, end, **kwargs)

    def test_root_and_selected_source(self):
        self.repo.write('sample.txt', 'one\ntwo\nthree\n')
        sha = self.repo.commit('Root message\n\nAn exact author statement.')
        report = self.inspect(start=2, end=3)
        self.assertEqual(report.source, 'two\nthree\n')
        self.assertEqual([(x.final_line, x.original_line, x.commit) for x in report.blame], [(2, 2, sha), (3, 3, sha)])
        self.assertEqual(report.changes[0].commit, sha)
        self.assertIn('An exact author statement.', report.changes[0].message)
        self.assertIn('+two', report.changes[0].patch)

    def test_shifted_attribution_and_range_changes(self):
        self.repo.write('sample.txt', 'alpha\nbeta\ngamma\n')
        initial = self.repo.commit('Initial')
        self.repo.write('sample.txt', 'inserted\nalpha\nBETA\ngamma\n')
        edited = self.repo.commit('Edit beta')
        report = self.inspect(start=2, end=4)
        self.assertEqual([x.commit for x in report.blame], [initial, edited, initial])
        self.assertEqual([x.original_line for x in report.blame], [1, 3, 3])
        self.assertEqual([x.commit for x in report.changes], [edited, initial])

    def test_rename_and_edit(self):
        self.repo.write('old.txt', ''.join(f'line {n}\n' for n in range(20)))
        initial = self.repo.commit('Original')
        self.repo.git('mv', 'old.txt', 'new.txt')
        self.repo.write('new.txt', 'CHANGED\n' + ''.join(f'line {n}\n' for n in range(1, 20)))
        renamed = self.repo.commit('Rename and edit')
        report = self.inspect('new.txt', 1, 3)
        self.assertEqual(report.blame[1].path, 'old.txt')
        self.assertEqual(report.blame[1].commit, initial)
        self.assertIn((renamed, 'old.txt', 'new.txt'), [(r.commit, r.old_path, r.new_path) for r in report.renames])

    def test_special_paths_are_literal(self):
        for file in ['space name.txt', 'unicodé.txt', ':colon.txt', '-dash.txt', '[glob]*.txt', 'tab\tname.txt', 'nested/deep.txt']:
            with self.subTest(file=file):
                self.repo.write(file, 'exact\n')
                self.repo.commit('Add path')
                report = self.inspect(file)
                self.assertEqual(report.source, 'exact\n')
                self.assertEqual(report.blame[0].path, file)

    def test_missing_ref_path_and_bad_ranges(self):
        self.repo.write('sample.txt', 'one\n')
        self.repo.commit()
        for kwargs in [dict(ref='--help'), dict(file='../sample.txt'), dict(file='/sample.txt'), dict(file='missing'), dict(start=0), dict(end=2), dict(end=201), dict(max_commits=51), dict(max_commits=0)]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.inspect(**kwargs)

    def test_binary_non_utf8_and_oversized_are_rejected(self):
        for content in [b'hello\x00world', b'\xff', b'a' * (512 * 1024 + 1)]:
            self.repo.write('sample.txt', content)
            self.repo.commit()
            with self.assertRaises(ValueError):
                self.inspect()

    def test_truncation_warning(self):
        for text in ['first\n', 'second\n', 'third\n']:
            self.repo.write('sample.txt', text)
            self.repo.commit(text.strip())
        report = self.inspect(max_commits=1)
        self.assertEqual(len(report.changes), 1)
        self.assertTrue(any('truncat' in w.lower() for w in report.warnings))

    def test_uncommitted_changes_are_excluded_and_ref_is_fixed(self):
        self.repo.write('sample.txt', 'committed\n')
        sha = self.repo.commit()
        self.repo.write('sample.txt', 'uncommitted\n')
        report = self.inspect(ref=sha)
        self.assertEqual(report.source, 'committed\n')
        self.assertEqual(report.revision, sha)

    def test_lf_line_numbering_and_missing_final_newline(self):
        self.repo.write('sample.txt', 'first\r\nsecond\vpart\nlast')
        self.repo.commit()
        report = self.inspect(start=2, end=3)
        self.assertEqual(report.source, 'second\vpart\nlast')
        self.assertEqual([item.content for item in report.blame], ['second\vpart', 'last'])

    def test_external_textconv_is_never_executed(self):
        self.repo.write('.gitattributes', '*.txt diff=unsafe\n')
        self.repo.write('sample.txt', 'ordinary\n')
        marker = self.repo.path / 'executed'
        self.repo.git('config', 'diff.unsafe.textconv', f'touch {marker}')
        self.repo.commit()
        self.assertEqual(self.inspect().source, 'ordinary\n')
        self.assertFalse(marker.exists())

    def test_configured_signature_verifier_is_never_executed(self):
        self.repo.write('sample.txt', 'one\n')
        self.repo.commit()
        tree = self.repo.git('rev-parse', 'HEAD^{tree}').decode().strip()
        raw = (f'tree {tree}\n'
               'author Fixture <fixture@example.invalid> 1700000000 +0000\n'
               'committer Fixture <fixture@example.invalid> 1700000000 +0000\n'
               'gpgsig -----BEGIN PGP SIGNATURE-----\n'
               ' fake-signature\n -----END PGP SIGNATURE-----\n\nSigned fixture\n')
        signed = self.repo.git('hash-object', '-t', 'commit', '-w', '--stdin', input=raw.encode()).decode().strip()
        self.repo.git('update-ref', 'HEAD', signed)
        marker = self.repo.path / 'signature-executed'
        verifier = self.repo.path / 'verifier'
        verifier.write_text('#!/bin/sh\ntouch "' + str(marker) + '"\nexit 1\n')
        verifier.chmod(0o700)
        self.repo.git('config', 'gpg.program', str(verifier))
        self.repo.git('config', 'log.showSignature', 'true')
        self.inspect()
        self.assertFalse(marker.exists())

    def test_remote_sanitization(self):
        self.repo.write('sample.txt', 'one\n')
        self.repo.commit()
        for raw, expected in [('git@github.com:owner/repo.git', 'https://github.com/owner/repo'), ('https://gitlab.com/team/sub/repo.git', 'https://gitlab.com/team/sub/repo'), ('https://token@github.com/a/b', None), ('https://github.com/a/b?token=secret', None), ('/private/path', None), ('https://evil.invalid/a/b', None)]:
            self.repo.git('config', 'remote.origin.url', raw)
            self.assertEqual(self.inspect().remote_url, expected)

    def test_optional_trace_failure_keeps_blame(self):
        self.repo.write('sample.txt', 'one\n')
        sha = self.repo.commit()
        run = reader.GitRunner.run

        def fail_trace(instance, *args, **kwargs):
            if 'log' in args:
                raise reader.GitError('Synthetic command output limit')
            return run(instance, *args, **kwargs)

        with patch.object(reader.GitRunner, 'run', fail_trace):
            report = self.inspect()
        self.assertEqual(report.blame[0].commit, sha)
        self.assertEqual(report.changes, [])
        self.assertTrue(any('timeline is incomplete' in w for w in report.warnings))
        self.assertTrue(any('rename evidence is incomplete' in w for w in report.warnings))

    def test_multiple_rename_records_and_no_final_newline(self):
        self.repo.write('first.txt', 'one')
        first = self.repo.commit()
        self.repo.git('mv', 'first.txt', 'second.txt')
        self.repo.commit()
        self.repo.git('mv', 'second.txt', 'third.txt')
        self.repo.commit()
        report = self.inspect('third.txt')
        self.assertEqual(report.source, 'one')
        self.assertEqual(report.blame[0].path, 'first.txt')
        self.assertEqual(report.blame[0].commit, first)
        self.assertEqual([(r.old_path, r.new_path) for r in report.renames], [('second.txt', 'third.txt'), ('first.txt', 'second.txt')])

    def test_partial_clones_are_rejected_before_object_reads(self):
        self.repo.write('sample.txt', 'one\n')
        self.repo.commit()
        for key, value in [('remote.origin.promisor', 'true'), ('extensions.partialClone', 'origin')]:
            with self.subTest(key=key):
                self.repo.git('config', key, value)
                with self.assertRaisesRegex(ValueError, 'partial|promisor'):
                    self.inspect()
                self.repo.git('config', '--unset', key)
        self.repo.git('config', 'remote.origin.promisor', 'false')
        self.assertEqual(self.inspect().source, 'one\n')

    def test_shallow_history_is_disclosed(self):
        self.repo.write('sample.txt', 'one\n')
        self.repo.commit()
        self.repo.write('sample.txt', 'two\n')
        self.repo.commit()
        with tempfile.TemporaryDirectory() as tmp:
            clone = Path(tmp) / 'clone'
            self.repo.git('clone', '-q', '--depth=1', self.repo.path.as_uri(), str(clone))
            report = reader.inspect_repository(clone, 'sample.txt', 1, 1)
        self.assertTrue(any('shallow' in w.lower() for w in report.warnings))

    def test_merge_disclosed(self):
        self.repo.write('sample.txt', 'one\n')
        self.repo.commit()
        self.repo.git('checkout', '-qb', 'side')
        self.repo.write('side.txt', 'side\n')
        self.repo.commit()
        self.repo.git('checkout', '-q', 'main')
        self.repo.write('main.txt', 'main\n')
        self.repo.commit()
        self.repo.git('merge', '-q', '--no-ff', 'side', '-m', 'Merge side')
        report = self.inspect()
        self.assertTrue(any('merge' in w.lower() for w in report.warnings))


if __name__ == '__main__':
    unittest.main()
