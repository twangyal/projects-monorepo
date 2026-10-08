"""Find function syntax in committed text; never import or execute it."""
import ast
from bisect import bisect_right
import io
from pathlib import PurePosixPath
import re
import sys
import tokenize

from .model import FunctionDefinition
from .native_protocol import SUFFIX_LANGUAGES
from .work_budget import current_work_budget


MAX_FUNCTIONS = 10_000
MAX_QUALIFIED_NAME_BYTES = 2 * 1024 * 1024


class FunctionParseError(ValueError):
    """The committed source cannot provide reliable function coordinates."""


def parse_functions(source: str, file: str) -> list[FunctionDefinition]:
    """Return every named function, preserving ambiguous repeated definitions."""
    suffix = PurePosixPath(file).suffix
    if suffix in SUFFIX_LANGUAGES:
        # Keep native dependencies out of the parent and the dependency-free
        # Python/manual-range paths. The supervisor imports no native grammar.
        from .native_parser import NativeParserError, parse_native_functions
        try:
            return parse_native_functions(source, SUFFIX_LANGUAGES[suffix])
        except NativeParserError as exc:
            raise FunctionParseError(str(exc)) from exc
    if suffix not in ('.py', '.pyi'):
        raise FunctionParseError('Function selection supports .py/.pyi and optional JavaScript/TypeScript files; use --lines for other text files.')
    if current_work_budget() is not None:
        from .native_parser import NativeParserError, parse_python_functions_isolated
        try:
            return parse_python_functions_isolated(source)
        except NativeParserError as exc:
            raise FunctionParseError(str(exc)) from exc
    if re.search(r'\r(?!\n)', source):
        raise FunctionParseError('Bare CR newlines have different Python and Git line numbers; use manual --lines selection.')
    # A UTF-8 signature and CRLF do not change physical line coordinates.
    parsed_source = source.removeprefix('\ufeff').replace('\r\n', '\n')
    try:
        tree = ast.parse(parsed_source, filename='<committed source>', mode='exec')
        # AST decorator expressions can begin after a parenthesized @ line.
        # Tokenization locates that @ without mistaking text inside strings.
        decorator_lines = []
        statement_start = True
        for token in tokenize.generate_tokens(io.StringIO(parsed_source).readline):
            if token.type == tokenize.NEWLINE:
                statement_start = True
            elif token.type not in (tokenize.INDENT, tokenize.DEDENT, tokenize.NL,
                                    tokenize.COMMENT, tokenize.ENDMARKER):
                if statement_start and token.type == tokenize.OP and token.string == '@':
                    decorator_lines.append(token.start[0])
                statement_start = False
        functions = []
        qualified_name_bytes = 0
        stack = [(tree, ())]
        while stack:
            node, scope = stack.pop()
            child_scope = scope
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if len(functions) >= MAX_FUNCTIONS:
                    raise FunctionParseError('Function catalog exceeds 10,000 functions; use manual --lines selection.')
                child_scope = (*scope, node.name)
                # A short source can repeat a long nested prefix many times.
                # Account for each name once, before retaining its definition.
                qualified_name = '.'.join(child_scope)
                name_bytes = len(qualified_name.encode('utf-8'))
                if qualified_name_bytes + name_bytes > MAX_QUALIFIED_NAME_BYTES:
                    raise FunctionParseError('Function catalog exceeds 2 MiB of qualified names; use manual --lines selection.')
                qualified_name_bytes += name_bytes
                start = node.lineno
                if node.decorator_list:
                    first_expression = min(item.lineno for item in node.decorator_list)
                    index = bisect_right(decorator_lines, first_expression) - 1
                    if index < 0:
                        raise FunctionParseError('Could not locate a function decorator; use manual --lines selection.')
                    start = decorator_lines[index]
                functions.append(FunctionDefinition(
                    qualified_name, start, node.end_lineno,
                    'async function' if isinstance(node, ast.AsyncFunctionDef) else 'function',
                ))
            elif isinstance(node, ast.ClassDef):
                child_scope = (*scope, node.name)
            stack.extend((child, child_scope) for child in ast.iter_child_nodes(node))
        return sorted(functions, key=lambda item: (item.start_line, item.end_line, item.qualified_name))
    except SyntaxError as exc:
        version = f'{sys.version_info.major}.{sys.version_info.minor}'
        raise FunctionParseError(
            f'Python {version} could not parse the committed source near line {exc.lineno}; '
            'check its syntax or use manual --lines selection.'
        ) from exc
    except (RecursionError, MemoryError, OverflowError, tokenize.TokenError) as exc:
        raise FunctionParseError('Committed source is too complex for the Python parser; use manual --lines selection.') from exc
