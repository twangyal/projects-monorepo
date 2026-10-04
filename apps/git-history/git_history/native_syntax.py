"""Optional grammar-backed syntax catalog, called only inside the bounded worker.

Importing this module loads stdlib/application types only. Committed source is
parsed as text, never imported, evaluated, or passed to repository tooling.
"""
from bisect import bisect_right
import importlib
import importlib.metadata

from .model import FunctionDefinition
from .native_protocol import (
    ERROR_CODES, LANGUAGES, MAX_FUNCTIONS, MAX_QUALIFIED_NAME_BYTES, MAX_SOURCE_BYTES,
)


class NativeSyntaxError(ValueError):
    def __init__(self, code: str):
        if code not in ERROR_CODES:
            raise ValueError('Unknown native syntax error code.')
        self.code = code
        super().__init__(code)


_PINNED = {'tree-sitter': '0.25.2', 'tree-sitter-javascript': '0.25.0',
           'tree-sitter-typescript': '0.23.2'}
_FUNCTIONS = frozenset({'function_declaration', 'generator_function_declaration'})
_EXPRESSIONS = frozenset({'arrow_function', 'function_expression', 'generator_function'})
_CLASSES = frozenset({'class_declaration', 'abstract_class_declaration'})
_WRAPPERS = frozenset({'parenthesized_expression', 'as_expression',
                       'satisfies_expression', 'type_assertion', 'non_null_expression'})
_BARRIERS = frozenset({'internal_module', 'module', 'ambient_declaration',
                       'interface_declaration', 'type_alias_declaration',
                       'function_signature', 'method_signature', 'abstract_method_signature',
                       'type_annotation', 'type_arguments', 'type_parameters', 'class_static_block'})
_IDENTIFIER_TYPES = frozenset({'identifier', 'type_identifier', 'property_identifier'})


def _parser(language: str):
    try:
        for package, version in _PINNED.items():
            if importlib.metadata.version(package) != version:
                raise NativeSyntaxError('dependencies')
        native = importlib.import_module('tree_sitter')
        if language == 'javascript':
            grammar = importlib.import_module('tree_sitter_javascript').language()
        else:
            grammar_module = importlib.import_module('tree_sitter_typescript')
            grammar = (grammar_module.language_tsx() if language == 'tsx'
                       else grammar_module.language_typescript())
        return native.Parser(native.Language(grammar))
    except NativeSyntaxError:
        raise
    except (ImportError, OSError, AttributeError, TypeError, ValueError,
            importlib.metadata.PackageNotFoundError) as error:
        raise NativeSyntaxError('dependencies') from error


def _unwrap(node):
    while node is not None and node.type in _WRAPPERS:
        children = [child for child in node.named_children if child.type != 'comment']
        if node.type == 'type_assertion':
            node = children[-1] if len(children) == 2 else None
        elif node.type in ('as_expression', 'satisfies_expression'):
            node = children[0] if len(children) == 2 else None
        else:
            node = children[0] if len(children) == 1 else None
    return node


def _previous_statement(node):
    previous = node.prev_named_sibling
    while previous is not None and previous.type == 'comment':
        previous = previous.prev_named_sibling
    return previous


def _bare_keyword(node, keyword):
    if node is None or node.type != 'expression_statement':
        return False
    children = node.children
    if any(child.type not in ('identifier', 'comment') for child in children):
        return False
    identifiers = [child for child in children if child.type == 'identifier']
    return len(identifiers) == 1 and identifiers[0].text == keyword


def _export_start(node):
    # Pinned grammars split a newline before an exported named declaration into
    # bare keyword-expression siblings. Match only those exact token sequences.
    previous = _previous_statement(node)
    if _bare_keyword(previous, b'default'):
        previous = _previous_statement(previous)
    if _bare_keyword(previous, b'export'):
        return previous.start_byte
    return None


def parse_native(source: str, language: str) -> list[FunctionDefinition]:
    """Return all supported callable definitions, or fail the complete catalog."""
    if language not in LANGUAGES:
        raise NativeSyntaxError('unsupported')
    try:
        raw = source.encode('utf-8', errors='strict')
    except (UnicodeError, AttributeError) as error:
        raise NativeSyntaxError('syntax') from error
    if len(raw) > MAX_SOURCE_BYTES:
        raise NativeSyntaxError('complexity')
    if b'\x00' in raw:
        raise NativeSyntaxError('syntax')
    try:
        parser = _parser(language)
        try:
            tree = parser.parse(raw)
        except ValueError as error:
            raise NativeSyntaxError('syntax') from error
        if tree is None or tree.root_node.has_error:
            raise NativeSyntaxError('syntax')
        line_breaks = [offset for offset, value in enumerate(raw) if value == 10]
        functions = []
        name_bytes = 0
        stack = [(tree.root_node, (), 'normal', None)]

        def identifier(node):
            if node is None or node.type not in _IDENTIFIER_TYPES:
                return None
            return raw[node.start_byte:node.end_byte].decode('utf-8', errors='strict')

        def body(node, scope):
            child = node.child_by_field_name('body')
            if child is not None:
                stack.append((child, scope, 'normal', None))

        def emit(name, node, container, scope, start=None):
            nonlocal name_bytes
            qualified = '.'.join((*scope, name))
            size = len(qualified.encode('utf-8'))
            if len(functions) >= MAX_FUNCTIONS or name_bytes + size > MAX_QUALIFIED_NAME_BYTES:
                raise NativeSyntaxError('complexity')
            name_bytes += size
            tokens = {child.type for child in node.children}
            kind = ('getter' if 'get' in tokens else 'setter' if 'set' in tokens
                    else 'async function' if 'async' in tokens else 'function')
            first = container.start_byte if start is None else start
            if not first < container.end_byte:
                raise NativeSyntaxError('syntax')
            functions.append(FunctionDefinition(
                qualified, bisect_right(line_breaks, first) + 1,
                bisect_right(line_breaks, container.end_byte - 1) + 1, kind))
            body(node, (*scope, name))

        def members(node, scope, role):
            pending = None
            tasks = []
            for child in node.named_children:
                if child.type == 'decorator' and role == 'classmember':
                    pending = child.start_byte if pending is None else pending
                elif child.type == 'comment':
                    continue
                else:
                    tasks.append((child, scope, role, pending))
                    pending = None
            stack.extend(reversed(tasks))

        def bound(name, value, container, scope, start=None, *, objects=False, classes=False):
            target = _unwrap(value)
            if name is None or target is None:
                return
            if target.type in _EXPRESSIONS:
                emit(name, target, container, scope, start)
            elif target.type == 'object' and objects:
                members(target, (*scope, name), 'objectmember')
            elif target.type == 'class' and classes:
                class_body = target.child_by_field_name('body')
                if class_body is not None:
                    members(class_body, (*scope, name), 'classmember')

        while stack:
            node, scope, role, start = stack.pop()
            kind = node.type
            if node.is_missing or node.is_error:
                raise NativeSyntaxError('syntax')
            if kind in _BARRIERS or kind.endswith('_type'):
                continue
            if kind in _FUNCTIONS:
                name = identifier(node.child_by_field_name('name'))
                if name is not None and node.child_by_field_name('body') is not None:
                    container = node.parent if node.parent.type == 'export_statement' else node
                    emit(name, node, container, scope,
                         _export_start(node) if container is node else None)
                continue
            if kind in _CLASSES:
                name = identifier(node.child_by_field_name('name'))
                class_body = node.child_by_field_name('body')
                if name is not None and class_body is not None:
                    members(class_body, (*scope, name), 'classmember')
                continue
            if kind == 'variable_declarator':
                bound(identifier(node.child_by_field_name('name')), node.child_by_field_name('value'),
                      node, scope, objects=True, classes=True)
                continue
            if kind == 'method_definition':
                if role in ('classmember', 'objectmember'):
                    name = identifier(node.child_by_field_name('name'))
                    if name is not None and node.child_by_field_name('body') is not None:
                        emit(name, node, node, scope, start)
                continue
            if kind == 'pair':
                if role == 'objectmember':
                    bound(identifier(node.child_by_field_name('key')), node.child_by_field_name('value'),
                          node, scope, objects=True)
                continue
            if kind in ('field_definition', 'public_field_definition'):
                if role == 'classmember':
                    name = identifier(node.child_by_field_name('name') or node.child_by_field_name('property'))
                    bound(name, node.child_by_field_name('value'), node, scope, start)
                continue
            # Unsupported namespaces are barriers, including named expressions
            # lacking an external binding; their descendants cannot become aliases.
            if kind in _EXPRESSIONS or kind in ('class', 'object'):
                continue
            if kind in _WRAPPERS:
                target = _unwrap(node)
                if target is not None:
                    stack.append((target, scope, 'normal', None))
                continue
            # Only enclosing executable statement containers are traversed here.
            stack.extend((child, scope, 'normal', None) for child in reversed(node.named_children))
        return sorted(functions, key=lambda item: (item.start_line, item.end_line, item.qualified_name))
    except (MemoryError, RecursionError, OverflowError) as error:
        raise NativeSyntaxError('complexity') from error
