"""Public source/context helpers retain bounded committed evidence and compatibility."""
from dataclasses import FrozenInstanceError, asdict
import json
import os
from pathlib import Path
import tempfile
from threading import Event
import unittest
from unittest.mock import patch

from git_history import context, model, reader
from git_history.render import render_html, render_json
from git_history.work_budget import WorkCancelled, work_budget
from tests.helpers import Repository


def report():
    return model.Report('fixture', 'a' * 40, 'HEAD', 'sample.py', 1, 1, 'value\n',
                        blame=[model.LineEvidence(1, 1, 'b' * 40, 'sample.py', 'Author', '0', 'Root', 'value')])


def documents():
    return [
        {'schema_version': 1, 'entries': [{'commit': 'a' * 40, 'source': 'Supplied PR',
         'url': 'https://github.com/owner/repo/pull/1', 'author': 'User',
         'excerpt': 'Unverified <script>literal</script> rationale.\r\n🙂'}]},
        {'schema_version': 1, 'revision': 'a' * 40, 'records': [{'commit': 'b' * 40,
         'title': 'Supplied discussion', 'url': 'https://github.com/owner/repo/issues/2#issuecomment-3',
         'author': 'User', 'excerpt': 'Unverified <script>literal</script> rationale.\n🙂'}]},
    ]


class SourceHelperTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.addCleanup(self.repo.close)

    def test_snapshot_is_frozen_and_preserves_committed_not_working_source(self):
        source = '\ufefffirst\r\nsecond\u2028part\r\n'
        path = 'nested/-literal [name]\n.py'
        self.repo.write(path, source)
        revision = self.repo.commit()
        self.repo.write(path, 'unsaved replacement\n')
        before = self.repo.git('status', '--porcelain')
        snapshot = reader.read_source(self.repo.path, path)
        self.assertIsInstance(snapshot, model.SourceSnapshot)
        self.assertEqual(asdict(snapshot), {'repo_name': self.repo.path.name, 'revision': revision,
                         'requested_ref': 'HEAD', 'path': path, 'source': source, 'line_count': 2})
        with self.assertRaises(FrozenInstanceError):
            snapshot.source = 'mutation'
        self.assertEqual(self.repo.git('status', '--porcelain'), before)

    def test_physical_lf_count_never_invents_trailing_lines(self):
        cases = [('', 0), ('one', 1), ('one\n', 1), ('one\n\n', 2), ('\n\n', 2),
                 ('one\rtwo\u2028three\u2029four\nfive\r\n', 2)]
        for index, (source, _) in enumerate(cases):
            self.repo.write(f'case-{index}.txt', source)
        revision = self.repo.commit()
        for index, (source, expected) in enumerate(cases):
            with self.subTest(index=index):
                snapshot = reader.read_source(self.repo.path, f'case-{index}.txt', revision)
                self.assertEqual(snapshot.line_count, expected)
                self.assertEqual(snapshot.source, source)
                self.assertEqual(snapshot.requested_ref, revision)

    def test_ref_resolves_once_when_branch_moves_between_stages(self):
        self.repo.write('source.txt', 'original\n')
        original = self.repo.commit()
        resolve = reader._resolve_repository

        def move_after_resolution(repo, ref):
            resolved = resolve(repo, ref)
            self.repo.write('source.txt', 'new head\n')
            self.repo.commit('Move branch during read')
            return resolved

        with patch.object(reader, '_resolve_repository', side_effect=move_after_resolution) as resolver:
            snapshot = reader.read_source(self.repo.path, 'source.txt')
        self.assertEqual(resolver.call_count, 1)
        self.assertEqual(snapshot.revision, original)
        self.assertEqual(snapshot.source, 'original\n')
        self.assertNotEqual(self.repo.git('rev-parse', 'HEAD').decode().strip(), original)

    def test_source_reuses_regular_utf8_blob_and_path_limits(self):
        self.repo.write('ordinary.txt', 'text\n')
        self.repo.write('nul.txt', b'text\x00hidden')
        self.repo.write('invalid.txt', b'\xff')
        self.repo.write('large.txt', b'x' * (reader.MAX_BLOB_BYTES + 1))
        os.symlink('ordinary.txt', self.repo.path / 'link.txt')
        self.repo.commit()
        for path in ('../ordinary.txt', '/ordinary.txt', 'ordinary.txt\x00', 'missing.txt',
                     'nul.txt', 'invalid.txt', 'large.txt', 'link.txt'):
            with self.subTest(path=path), self.assertRaises(reader.ReaderError):
                reader.read_source(self.repo.path, path)

    def test_exact_blob_byte_boundary_does_not_require_function_parser(self):
        source = 'é' * (reader.MAX_BLOB_BYTES // 2)
        self.repo.write('boundary.unknown', source)
        self.repo.commit()
        with patch.object(reader, 'parse_functions', side_effect=AssertionError('No parsing')):
            snapshot = reader.read_source(self.repo.path, 'boundary.unknown')
        self.assertEqual(snapshot.source, source)
        self.assertEqual(snapshot.line_count, 1)
        self.assertEqual(len(snapshot.source.encode('utf-8')), reader.MAX_BLOB_BYTES)

    def test_source_supports_bare_repository(self):
        self.repo.write('sample.txt', 'bare source\n')
        revision = self.repo.commit()
        with tempfile.TemporaryDirectory() as temporary:
            bare = Path(temporary) / 'fixture.git'
            self.repo.git('clone', '--bare', '--quiet', str(self.repo.path), str(bare))
            snapshot = reader.read_source(bare, 'sample.txt', revision)
        self.assertEqual(snapshot.repo_name, 'fixture.git')
        self.assertEqual(snapshot.revision, revision)
        self.assertEqual(snapshot.source, 'bare source\n')

    def test_cancellation_after_read_prevents_source_publication(self):
        self.repo.write('sample.txt', 'source\n')
        self.repo.commit()
        cancelled = Event()
        load = reader._load_snapshot

        def cancel_after_load(*args):
            snapshot = load(*args)
            cancelled.set()
            return snapshot

        with patch.object(reader, '_load_snapshot', side_effect=cancel_after_load):
            with work_budget(cancel=cancelled), self.assertRaises(WorkCancelled):
                reader.read_source(self.repo.path, 'sample.txt')

    def test_cancellation_between_history_stages_cannot_become_partial_success(self):
        self.repo.write('sample.txt', 'source\n')
        self.repo.commit()
        cancelled = Event()
        changes = reader._changes

        def cancel_after_changes(*args):
            evidence = changes(*args)
            cancelled.set()
            return evidence

        with patch.object(reader, '_changes', side_effect=cancel_after_changes):
            with patch.object(reader, '_renames', return_value=[]) as renames:
                with work_budget(cancel=cancelled), self.assertRaises(WorkCancelled):
                    reader.inspect_repository(self.repo.path, 'sample.txt', 1, 1)
                renames.assert_not_called()


class ContextHelperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'context.json'

    def test_bytes_text_and_file_preserve_both_envelopes_and_renderers(self):
        target = report()
        before = asdict(target)
        for document in documents():
            with self.subTest(envelope='records' if 'records' in document else 'entries'):
                text = json.dumps(document, ensure_ascii=False)
                raw = text.encode('utf-8')
                self.path.write_bytes(raw)
                loaded = context.load_context(self.path, target)
                from_bytes = context.parse_context(raw, target)
                from_text = context.parse_context(text, target)
                self.assertIs(type(loaded), type(from_bytes))
                self.assertIs(type(loaded), type(from_text))
                self.assertEqual(loaded, from_bytes)
                self.assertEqual(loaded, from_text)
                self.assertEqual(render_json(target, loaded), render_json(target, from_text))
                self.assertEqual(render_html(target, loaded), render_html(target, from_bytes))
        self.assertEqual(asdict(target), before)

    def test_empty_envelopes_preserve_records_type_and_revision_rule(self):
        entries = context.parse_context('{"schema_version":1,"entries":[]}', report())
        records = context.parse_context(json.dumps({'schema_version': 1, 'revision': 'a' * 40, 'records': []}), report())
        self.assertEqual(entries, [])
        self.assertIs(type(entries), list)
        self.assertEqual(records, [])
        self.assertIsInstance(records, context.ContextRecords)
        with self.assertRaisesRegex(ValueError, 'revision'):
            context.parse_context(json.dumps({'schema_version': 1, 'revision': 'b' * 40, 'records': []}), report())

    def test_raw_byte_cap_is_exact_and_counts_utf8_not_characters(self):
        text = '{"schema_version":1,"entries":[]}'
        raw = text.encode() + b' ' * (context.MAX_CONTEXT_BYTES - len(text))
        self.assertEqual(context.parse_context(raw, report()), [])
        self.assertEqual(context.parse_context(raw.decode(), report()), [])
        for value in (raw + b' ', raw.decode() + ' ', 'é' * (context.MAX_CONTEXT_BYTES // 2 + 1)):
            with self.subTest(kind=type(value).__name__), self.assertRaisesRegex(ValueError, '256 KiB'):
                context.parse_context(value, report())

    def test_invalid_unicode_json_depth_and_scalar_inputs_fail_safely(self):
        values = [b'\xff', '\ud800', b'\xef\xbb\xbf{}',
                  '{"schema_version":1,"schema_version":1,"entries":[]}',
                  '{"schema_version":NaN,"entries":[]}', '[' * 6000 + ']' * 6000,
                  None, {}, bytearray(b'{}')]
        for value in values:
            with self.subTest(kind=type(value).__name__), self.assertRaises(ValueError):
                context.parse_context(value, report())

    def test_parser_is_atomic_and_retains_existing_error_messages(self):
        target = report()
        for document in documents():
            field = 'records' if 'records' in document else 'entries'
            document[field].append({**document[field][0], 'commit': 'c' * 40})
            text = json.dumps(document)
            self.path.write_text(text)
            with self.assertRaises(ValueError) as from_file:
                context.load_context(self.path, target)
            with self.assertRaises(ValueError) as from_text:
                context.parse_context(text, target)
            self.assertEqual(str(from_file.exception), str(from_text.exception))
            self.assertNotIn('literal', str(from_text.exception))
        self.assertIsNone(target.supplied_context)

    def test_file_loader_delegates_after_bounded_read(self):
        raw = b'{"schema_version":1,"entries":[]}'
        self.path.write_bytes(raw)
        target = report()
        with patch.object(context, 'parse_context', wraps=context.parse_context) as parser:
            self.assertEqual(context.load_context(self.path, target), [])
        parser.assert_called_once_with(raw, target)

    def test_context_cancellation_after_validation_prevents_publication(self):
        cancelled = Event()
        validate = context.validate_records

        def cancel_after_validation(*args):
            records = validate(*args)
            cancelled.set()
            return records

        document = json.dumps({'schema_version': 1, 'revision': 'a' * 40, 'records': []})
        with patch.object(context, 'validate_records', side_effect=cancel_after_validation):
            with work_budget(cancel=cancelled), self.assertRaises(WorkCancelled):
                context.parse_context(document, report())


if __name__ == '__main__':
    unittest.main()
