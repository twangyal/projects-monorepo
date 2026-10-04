"""Original native syntax fixtures with independent names and physical ranges."""
import importlib.util
import os
import sys
import unittest
from unittest.mock import patch

from git_history.native_syntax import NativeSyntaxError, parse_native


AVAILABLE = all(importlib.util.find_spec(name) is not None for name in
                ('tree_sitter', 'tree_sitter_javascript', 'tree_sitter_typescript'))

if os.environ.get('GIT_HISTORY_REQUIRE_JAVASCRIPT') == '1' and not AVAILABLE:
    raise RuntimeError('Mandatory optional native parser tests require installed dependencies.')


@unittest.skipUnless(AVAILABLE, 'optional pinned native parser packages not installed')
class NativeSyntaxTests(unittest.TestCase):
    def records(self, source, language='javascript'):
        return [(f.qualified_name, f.start_line, f.end_line, f.kind)
                for f in parse_native(source, language)]

    def test_declarations_generators_external_bindings_and_nested_scopes(self):
        source = ('export async function fetch() {\n'
                  ' function inner() {}\n'
                  ' const arrow = async x => x;\n'
                  '}\n'
                  'const expression = function internal(){ function child(){} };\n'
                  'function* gen() {}\n'
                  'const generator = function* alias(){};\n'
                  'export default function named(){}\n'
                  'export default function() {function hidden(){}}\n')
        self.assertEqual(self.records(source), [
            ('fetch', 1, 4, 'async function'), ('fetch.inner', 2, 2, 'function'),
            ('fetch.arrow', 3, 3, 'async function'), ('expression', 5, 5, 'function'),
            ('expression.child', 5, 5, 'function'), ('gen', 6, 6, 'function'),
            ('generator', 7, 7, 'function'), ('named', 8, 8, 'function')])

    def test_classes_methods_accessors_fields_and_class_expression_binding(self):
        source = ('class C {\n constructor(){}\n static async run(){}\n'
                  ' get value(){return 1}\n set value(x){}\n'
                  ' arrow = () => {function inside(){}};\n'
                  ' #private(){function hidden(){}}\n'
                  ' [computed](){function hidden(){}}\n'
                  ' "literal"(){function hidden(){}}\n}\n'
                  'const External = class Internal {method(){}};\n')
        self.assertEqual(self.records(source), [
            ('C.constructor', 2, 2, 'function'), ('C.run', 3, 3, 'async function'),
            ('C.value', 4, 4, 'getter'), ('C.value', 5, 5, 'setter'),
            ('C.arrow', 6, 6, 'function'), ('C.arrow.inside', 6, 6, 'function'),
            ('External.method', 11, 11, 'function')])

    def test_identifier_object_namespaces_recursive_properties_and_barriers(self):
        source = ('const O = {\n method(){function child(){}},\n get x(){return 1},\n'
                  ' nested:{ fn:()=>1, expression:function alias(){function child(){}} },\n'
                  ' "quoted":()=>{function hidden(){}}, [key]:()=>{function hidden(){}},\n};\n'
                  'function outer(){\n consume(()=>{function hidden(){}});\n'
                  ' consume({method(){function hidden(){}}});\n'
                  ' assigned = function named(){function hidden(){}};\n'
                  ' const {destructured} = ()=>{function hidden(){}};\n'
                  ' const local = {f(){ class Inner {m(){}} }};\n}\n')
        names=[f.qualified_name for f in parse_native(source, 'javascript')]
        self.assertEqual(names, ['O.method', 'O.method.child', 'O.x', 'O.nested.expression',
                                'O.nested.expression.child', 'O.nested.fn',
                                'outer', 'outer.local.f', 'outer.local.f.Inner.m'])

    def test_typescript_wrappers_are_transparent_but_types_not_namespaces(self):
        source = ('const a = (((x:number)=>x));\n'
                  'const b = (()=>1) as (()=>number);\n'
                  'const c = (()=>1) satisfies Fn;\n'
                  'const d = <Fn>(()=>1);\n'
                  'const e = (()=>1)!;\n'
                  'const C = (class Alias { m(){} }) as Constructor;\n'
                  'const O = ({nested: {f: (()=>1) as Fn}}) satisfies Shape;\n'
                  'namespace N {export function hidden(){}}\n'
                  'module M {function hidden(){}}\n'
                  'declare function signature():void;\n'
                  'interface I {signature():void; f:()=>void}\n'
                  'type F = ()=>void;\n')
        self.assertEqual(self.records(source, 'typescript'), [
            ('a',1,1,'function'), ('b',2,2,'function'), ('c',3,3,'function'),
            ('d',4,4,'function'), ('e',5,5,'function'), ('C.m',6,6,'function'),
            ('O.nested.f',7,7,'function')])

    def test_overloads_abstract_classes_and_tsx(self):
        source = ('export function f(x:string):string;\n'
                  'export function f(x:number):number;\n'
                  'export function f(x:any){ return x; }\n'
                  'abstract class C {abstract absent():void; concrete(){}}\n'
                  'export const Component = ({x}:{x:string}) => <p>{x}</p>;\n')
        self.assertEqual(self.records(source,'tsx'), [
            ('f',3,3,'function'), ('C.concrete',4,4,'function'), ('Component',5,5,'function')])

    def test_javascript_and_typescript_decorator_ranges_do_not_take_class_decorators(self):
        source = ('@classDecorator\nclass C {\n @first\n // note\n @second()\n'
                  ' method(){}\n field = 1;\n ordinary(){}\n}\n')
        expected=[('C.method',3,6,'function'), ('C.ordinary',8,8,'function')]
        self.assertEqual(self.records(source), expected)
        self.assertEqual(self.records(source,'typescript'), expected)

    def test_original_bom_crlf_unicode_separator_and_identifier_spelling(self):
        source = '\ufefffunction café(){}\r\nfunction \\u0066(){\r\n return 1;\r\n}\r\nfunction a(){}\u2028function b(){}\n'
        self.assertEqual(self.records(source), [
            ('café',1,1,'function'), ('\\u0066',2,4,'function'),
            ('a',5,5,'function'), ('b',5,5,'function')])

    def test_binding_range_does_not_take_const_or_other_declarators(self):
        source = ('const\n f =\n (()=>\n 1),\n unrelated = 3;\n'
                  'export\n function g(){\n }\n')
        self.assertEqual(self.records(source), [('f',2,4,'function'), ('g',6,8,'function')])

    def test_newline_export_prefix_requires_only_bare_export_and_comments(self):
        self.assertEqual(self.records('export /*inline*/\n // note\n function f(){}'),
                         [('f',1,3,'function')])
        self.assertEqual(self.records('export;\nfunction f(){}'), [('f',2,2,'function')])
        self.assertEqual(self.records('export\n sideEffect();\nfunction f(){}'),
                         [('f',3,3,'function')])

    def test_split_default_export_prefix_is_exact_in_typescript_and_tsx(self):
        for language in ['typescript','tsx']:
            with self.subTest(language=language):
                self.assertEqual(self.records('export\n // comment\n default\n function f(){}',language),
                                 [('f',1,4,'function')])
                self.assertEqual(self.records('export;\n default\n function f(){}',language),
                                 [('f',3,3,'function')])
                self.assertEqual(self.records('export\n intervening();\n default\n function f(){}',language),
                                 [('f',4,4,'function')])
                self.assertEqual(self.records('export\n default;\n function f(){}',language),
                                 [('f',3,3,'function')])
        # The pinned JavaScript grammar recovers an ERROR(default); never bypass
        # its whole-tree rejection even though this source is valid ECMAScript.
        with self.assertRaises(NativeSyntaxError) as error:
            parse_native('export\n default\n function f(){}','javascript')
        self.assertEqual(error.exception.code,'syntax')

    def test_static_initializers_and_parameter_callbacks_are_omission_barriers(self):
        source = ('class C { static { function hidden(){} } method(){} }\n'
                  'function outer(cb = function named(){function hidden(){}}) {function child(){}}')
        self.assertEqual([f.qualified_name for f in parse_native(source,'javascript')],
                         ['C.method','outer','outer.child'])

    def test_syntax_recovery_missing_nul_and_surrogate_are_whole_catalog_errors(self):
        for source in ['function good(){}\nfunction broken( {', 'function f(){',
                       'function f(){}\x00', '//\ud800\nfunction f(){}']:
            with self.subTest(source=repr(source)), self.assertRaises(NativeSyntaxError) as error:
                parse_native(source, 'javascript')
            self.assertEqual(error.exception.code, 'syntax')

    def test_actual_catalog_and_name_budgets_without_mocked_constants(self):
        self.assertEqual(len(parse_native('function f(){}\n' * 10000,'javascript')),10000)
        with self.assertRaises(NativeSyntaxError) as count_error:
            parse_native('function f(){}\n' * 10001,'javascript')
        self.assertEqual(count_error.exception.code,'complexity')
        source = 'function ' + 'prefix' * 1500 + '(){' + 'function child(){}' * 300 + '}'
        with self.assertRaises(NativeSyntaxError) as names_error:
            parse_native(source,'javascript')
        self.assertEqual(names_error.exception.code,'complexity')

    def test_catalog_and_qualified_name_caps_are_atomic(self):
        with patch('git_history.native_syntax.MAX_FUNCTIONS',1):
            with self.assertRaises(NativeSyntaxError) as error:
                parse_native('function a(){} function b(){}','javascript')
            self.assertEqual(error.exception.code,'complexity')
        with patch('git_history.native_syntax.MAX_QUALIFIED_NAME_BYTES',3):
            with self.assertRaises(NativeSyntaxError) as error:
                parse_native('function café(){}','javascript')
            self.assertEqual(error.exception.code,'complexity')


class NativeEnvelopeTests(unittest.TestCase):
    def test_module_import_has_no_native_dependency_imports(self):
        # A fresh interpreter avoids optional imports made by earlier tests.
        import subprocess
        result = subprocess.run([sys.executable,'-c',
            "import sys; import git_history.native_syntax; assert not any(k.startswith('tree_sitter') for k in sys.modules)"],
            capture_output=True, timeout=5)
        self.assertEqual(result.returncode,0,result.stderr.decode())

    def test_source_and_language_rejected_before_loading_dependencies(self):
        for source,language,code in [('x'*524289,'javascript','complexity'),
                                     ('function f(){}','python','unsupported')]:
            with self.assertRaises(NativeSyntaxError) as error:
                parse_native(source,language)
            self.assertEqual(error.exception.code,code)

    def test_missing_or_mismatched_dependencies_have_fixed_code(self):
        with patch('git_history.native_syntax.importlib.metadata.version',return_value='0.0'):
            with self.assertRaises(NativeSyntaxError) as error:
                parse_native('function f(){}','javascript')
            self.assertEqual(error.exception.code,'dependencies')


if __name__ == '__main__':
    unittest.main()
