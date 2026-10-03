"""Function selection uses committed syntax without executing inspected code."""
import unittest
from unittest.mock import patch

from git_history import reader
from tests.helpers import Repository


class FunctionTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.addCleanup(self.repo.close)

    def commit_source(self, source, file='module.py'):
        self.repo.write(file, source)
        return self.repo.commit('Committed Python source')

    def test_catalog_lists_decorated_async_methods_and_nested_functions(self):
        source = ('@decorator(\n'
                  '    "argument",\n'
                  ')\n'
                  'async def fetch():\n'
                  '    def inner():\n'
                  '        return 1\n'
                  '    return inner()\n'
                  '\n'
                  'class Store:\n'
                  '    @classmethod\n'
                  '    def build(cls):\n'
                  '        async def child():\n'
                  '            return None\n'
                  '        return cls()\n'
                  '\n'
                  'if True:\n'
                  '    def branch():\n'
                  '        pass\n')
        sha = self.commit_source(source)
        catalog = reader.list_functions(self.repo.path, 'module.py')
        self.assertEqual(catalog.revision, sha)
        self.assertEqual(catalog.requested_ref, 'HEAD')
        self.assertEqual(catalog.repo_name, self.repo.path.name)
        self.assertEqual(catalog.path, 'module.py')
        self.assertEqual([(f.qualified_name, f.start_line, f.end_line, f.kind)
                          for f in catalog.functions], [
            ('fetch', 1, 7, 'async function'),
            ('fetch.inner', 5, 6, 'function'),
            ('Store.build', 10, 14, 'function'),
            ('Store.build.child', 12, 13, 'async function'),
            ('branch', 17, 18, 'function'),
        ])

    def test_parenthesized_decorator_includes_at_sign_line(self):
        self.commit_source('@(\n    decorator\n)\ndef decorated():\n    pass\n')
        report = reader.inspect_repository(self.repo.path, 'module.py', function='decorated')
        self.assertEqual((report.start_line, report.end_line), (1, 5))
        self.assertTrue(report.source.startswith('@(\n'))

    def test_matrix_operator_inside_decorator_does_not_move_range_start(self):
        self.commit_source('@(\n    left @ right\n)\ndef decorated():\n    pass\n')
        function = reader.list_functions(self.repo.path, 'module.py').functions[0]
        self.assertEqual(function.start_line, 1)

    def test_function_selection_matches_manual_range_evidence(self):
        self.commit_source('class Example:\n    def method(self):\n        return 1\n')
        selected = reader.inspect_repository(self.repo.path, 'module.py', function='Example.method')
        manual = reader.inspect_repository(self.repo.path, 'module.py', 2, 3)
        self.assertEqual(selected.selected_function, 'Example.method')
        self.assertIsNone(manual.selected_function)
        selected.selected_function = None
        self.assertEqual(selected, manual)

    def test_nested_classes_and_control_flow_preserve_qualified_names(self):
        self.commit_source('def outer():\n'
                           '    class Inner:\n'
                           '        if True:\n'
                           '            def method(self):\n'
                           '                pass\n')
        catalog = reader.list_functions(self.repo.path, 'module.py')
        self.assertEqual([f.qualified_name for f in catalog.functions], ['outer', 'outer.Inner.method'])

    def test_duplicate_names_remain_listed_and_selection_is_ambiguous(self):
        self.commit_source('if True:\n    def duplicate():\n        pass\n'
                           'else:\n    def duplicate():\n        pass\n')
        catalog = reader.list_functions(self.repo.path, 'module.py')
        self.assertEqual([(f.qualified_name, f.start_line) for f in catalog.functions],
                         [('duplicate', 2), ('duplicate', 5)])
        with self.assertRaisesRegex(reader.ReaderError, '[Aa]mbiguous') as caught:
            reader.inspect_repository(self.repo.path, 'module.py', function='duplicate')
        self.assertIn('2:3, 5:6', str(caught.exception))
        manual = reader.inspect_repository(self.repo.path, 'module.py', 2, 3)
        self.assertEqual(manual.source, '    def duplicate():\n        pass\n')

    def test_ambiguous_error_bounds_candidate_ranges(self):
        self.commit_source('def duplicate():\n    pass\n' * 20)
        with self.assertRaises(reader.ReaderError) as caught:
            reader.inspect_repository(self.repo.path, 'module.py', function='duplicate')
        message = str(caught.exception)
        self.assertIn('1:2, 3:4, 5:6, 7:8, 9:10', message)
        self.assertNotIn('11:12', message)
        self.assertIn('list functions', message)

    def test_unknown_name_requires_exact_qualification(self):
        self.commit_source('class Example:\n    def method(self):\n        pass\n')
        with self.assertRaisesRegex(reader.ReaderError, '[Nn]o function|[Uu]nknown'):
            reader.inspect_repository(self.repo.path, 'module.py', function='method')

    def test_worktree_source_and_module_side_effects_are_excluded(self):
        marker = self.repo.path / 'executed'
        self.commit_source('from pathlib import Path\n'
                           f'Path({str(marker)!r}).write_text("executed")\n'
                           'def committed():\n    return 1\n')
        self.repo.write('module.py', 'def uncommitted():\n    pass\n')
        self.assertEqual([f.qualified_name for f in reader.list_functions(self.repo.path, 'module.py').functions], ['committed'])
        report = reader.inspect_repository(self.repo.path, 'module.py', function='committed')
        self.assertIn('def committed', report.source)
        self.assertFalse(marker.exists())

    def test_snapshot_is_fixed_if_ref_moves_during_selection(self):
        original = self.commit_source('def original():\n    return 1\n')
        run = reader.GitRunner.run
        resolutions = []

        def move_ref(instance, *args, **kwargs):
            result = run(instance, *args, **kwargs)
            if 'rev-parse' in args and '--verify' in args:
                resolutions.append(result)
                self.repo.write('module.py', 'def replacement():\n    return 2\n')
                self.repo.commit('Move the requested ref')
            return result

        with patch.object(reader.GitRunner, 'run', move_ref):
            report = reader.inspect_repository(self.repo.path, 'module.py', function='original')
        self.assertEqual(report.revision, original)
        self.assertEqual(report.blame[0].commit, original)
        self.assertEqual(report.changes[0].commit, original)
        self.assertNotIn('replacement', report.source)
        self.assertEqual(len(resolutions), 1)

    def test_large_functions_are_listed_but_require_smaller_manual_range(self):
        self.commit_source('def large():\n' + '    pass\n' * 200)
        function = reader.list_functions(self.repo.path, 'module.py').functions[0]
        self.assertEqual((function.start_line, function.end_line), (1, 201))
        with self.assertRaisesRegex(reader.ReaderError, '200') as caught:
            reader.inspect_repository(self.repo.path, 'module.py', function='large')
        self.assertIn('1:201', str(caught.exception))
        self.assertEqual(reader.inspect_repository(self.repo.path, 'module.py', 1, 2).end_line, 2)

    def test_python_stubs_and_literal_paths_are_supported(self):
        for file in ['types.pyi', 'nested/space é.py', ':module.py', '-module.py']:
            with self.subTest(file=file):
                self.commit_source('def stub(value: int) -> str: ...\n', file)
                self.assertEqual(reader.list_functions(self.repo.path, file).functions[0].qualified_name, 'stub')
                self.assertEqual(reader.inspect_repository(self.repo.path, file, function='stub').start_line, 1)

    def test_non_python_listing_is_rejected_but_manual_ranges_still_work(self):
        self.commit_source('def looks_like_python(): pass\n', 'notes.txt')
        with self.assertRaisesRegex(reader.ReaderError, r'\.py'):
            reader.list_functions(self.repo.path, 'notes.txt')
        with self.assertRaisesRegex(reader.ReaderError, r'\.py'):
            reader.inspect_repository(self.repo.path, 'notes.txt', function='looks_like_python')
        self.assertIn('looks_like_python', reader.inspect_repository(self.repo.path, 'notes.txt', 1, 1).source)

    def test_syntax_and_depth_failures_are_actionable_without_source_leaks(self):
        for source in ['def broken(:\n    SECRET_SOURCE_MARKER\n', 'value = ' + '(' * 300 + '1' + ')' * 300 + '\n']:
            with self.subTest(source_length=len(source)):
                self.commit_source(source)
                with self.assertRaises(reader.ReaderError) as caught:
                    reader.list_functions(self.repo.path, 'module.py')
                self.assertNotIn('SECRET_SOURCE_MARKER', str(caught.exception))
                self.assertRegex(str(caught.exception), 'Python|parser|syntax|complex')

    def test_parser_resource_failures_have_safe_manual_range_guidance(self):
        self.commit_source('def normal(): pass\n')
        for failure in (MemoryError, RecursionError, OverflowError):
            with self.subTest(failure=failure.__name__):
                with patch('git_history.function_parser.ast.parse',
                           side_effect=failure('PRIVATE_PARSER_DETAIL')):
                    with self.assertRaises(reader.ReaderError) as caught:
                        reader.list_functions(self.repo.path, 'module.py')
                self.assertNotIn('PRIVATE_PARSER_DETAIL', str(caught.exception))
                self.assertIn('--lines', str(caught.exception))

    def test_crlf_and_utf8_bom_preserve_git_line_numbers(self):
        self.commit_source('\ufeff# coding: utf-8\r\n@decorator\r\ndef selected():\r\n    pass\r\n')
        report = reader.inspect_repository(self.repo.path, 'module.py', function='selected')
        self.assertEqual((report.start_line, report.end_line), (2, 4))
        self.assertEqual(report.source, '@decorator\r\ndef selected():\r\n    pass\r\n')

    def test_bare_cr_function_coordinates_fail_with_manual_selection_guidance(self):
        self.commit_source('# comment\rdef selected():\r    pass\r')
        with self.assertRaisesRegex(reader.ReaderError, '--lines'):
            reader.list_functions(self.repo.path, 'module.py')
        self.assertIn('def selected', reader.inspect_repository(self.repo.path, 'module.py', 1, 1).source)

    def test_empty_module_has_empty_catalog(self):
        self.commit_source('# no functions\n')
        self.assertEqual(reader.list_functions(self.repo.path, 'module.py').functions, [])

    def test_exactly_one_complete_selection_is_required(self):
        self.commit_source('def selected(): pass\n')
        for kwargs in [{}, {'start': 1}, {'end': 1}, {'start': 1, 'end': 1, 'function': 'selected'}, {'start': 1, 'function': 'selected'}, {'function': ''}, {'function': 12}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(reader.ReaderError):
                reader.inspect_repository(self.repo.path, 'module.py', **kwargs)

    def test_catalog_function_count_is_bounded_with_manual_range_fallback(self):
        self.commit_source('def repeated(): pass\n' * 10000)
        self.assertEqual(len(reader.list_functions(self.repo.path, 'module.py').functions), 10000)
        self.commit_source('def repeated(): pass\n' * 10001)
        with self.assertRaisesRegex(reader.ReaderError, '10,000.*--lines'):
            reader.list_functions(self.repo.path, 'module.py')
        self.assertEqual(reader.inspect_repository(self.repo.path, 'module.py', 1, 1).source,
                         'def repeated(): pass\n')

    def test_catalog_rejects_qualified_name_amplification_in_utf8_bytes(self):
        for letter, depth, siblings in [('A', 50, 500), ('Α', 25, 110)]:
            with self.subTest(letter=letter):
                classes = ''.join(' ' * level + 'class ' + letter * 400 + str(level) + ':\n'
                                  for level in range(depth))
                functions = ''.join(' ' * depth + f'def function{index}(): pass\n'
                                    for index in range(siblings))
                source = classes + functions
                self.assertLess(len(source.encode('utf-8')), 512 * 1024)
                self.commit_source(source)
                with self.assertRaisesRegex(reader.ReaderError, '2 MiB.*--lines'):
                    reader.list_functions(self.repo.path, 'module.py')

    def test_function_catalog_keeps_existing_source_limits(self):
        for source in [b'\x00', b'\xff', b'#' * (512 * 1024 + 1)]:
            self.commit_source(source)
            with self.assertRaises(reader.ReaderError):
                reader.list_functions(self.repo.path, 'module.py')


if __name__ == '__main__':
    unittest.main()
