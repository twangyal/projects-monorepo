"""Supervise optional native parsing without loading grammars in this process."""
from __future__ import annotations

import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time

from .model import FunctionDefinition
from .native_protocol import (
    ERROR_CODES, KINDS, LANGUAGES, MAX_FUNCTIONS, MAX_OUTPUT_BYTES,
    MAX_QUALIFIED_NAME_BYTES, MAX_SOURCE_BYTES, WALL_SECONDS,
)
from .work_budget import charge_work_output, check_work_budget


class NativeParserError(ValueError):
    """Sanitized, actionable optional-parser failure."""


_ERRORS = {
    'dependencies': 'Optional JavaScript/TypeScript parser dependencies are missing or incompatible. '
                    'Install local-git-history[javascript], or use manual --lines selection.',
    'syntax': 'The committed JavaScript/TypeScript source has invalid or unsupported syntax. '
              'Check its syntax or use manual --lines selection.',
    'complexity': 'The committed source exceeds the native parser complexity limits; '
                  'use manual --lines selection.',
    'unsupported': 'Bounded native parsing requires supported POSIX isolation and language; '
                   'use manual --lines selection.',
}
_PROTOCOL_ERROR = 'The native parser returned an invalid protocol reply; use manual --lines selection.'


def _reply(raw: bytes, line_count: int) -> list[FunctionDefinition]:
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate field.')
            result[key] = value
        return result

    def constant(_value):
        raise ValueError('Nonfinite JSON.')

    try:
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=constant)
        if type(value) is not dict:
            raise ValueError('Expected object.')
        if set(value) == {'error'}:
            code = value['error']
            if type(code) is not str or code not in ERROR_CODES:
                raise ValueError('Unknown error.')
            raise NativeParserError(_ERRORS[code])
        if set(value) != {'functions'} or type(value['functions']) is not list:
            raise ValueError('Expected catalog.')
        functions = value['functions']
        if len(functions) > MAX_FUNCTIONS:
            raise ValueError('Catalog count exceeded.')
        result = []
        total_names = 0
        for item in functions:
            if type(item) is not dict or set(item) != {'qualified_name', 'start_line', 'end_line', 'kind'}:
                raise ValueError('Invalid entry fields.')
            name, start, end, kind = (item[key] for key in ('qualified_name', 'start_line', 'end_line', 'kind'))
            if type(name) is not str or not name or '\0' in name:
                raise ValueError('Invalid name.')
            total_names += len(name.encode('utf-8'))
            if total_names > MAX_QUALIFIED_NAME_BYTES:
                raise ValueError('Catalog names exceeded.')
            if (type(start) is not int or type(end) is not int
                    or not 1 <= start <= end <= line_count
                    or type(kind) is not str or kind not in KINDS):
                raise ValueError('Invalid coordinates or kind.')
            result.append(FunctionDefinition(name, start, end, kind))
        return result
    except NativeParserError:
        raise
    except (ValueError, TypeError, RecursionError, MemoryError, OverflowError):
        raise NativeParserError(_PROTOCOL_ERROR) from None


def _kill_and_reap(process: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def _run_worker(source: bytes, language: str, line_count: int) -> list[FunctionDefinition]:
    # These paths belong to the installed application, never to the inspected
    # repository. -I rejects PYTHONPATH, user-site and cwd import injection.
    package = Path(__file__).resolve().parent
    check_work_budget()
    deadline = time.monotonic() + WALL_SECONDS
    try:
        process = subprocess.Popen(
            [sys.executable, '-I', '-B', str(package / 'native_worker.py'), language],
            cwd=package.parent, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, shell=False, bufsize=0, start_new_session=True,
        )
    except (OSError, ValueError):
        raise NativeParserError('Could not start the isolated native parser; use manual --lines selection.') from None
    selector = None
    completed = False
    try:
        selector = selectors.DefaultSelector()
        assert process.stdin is not None and process.stdout is not None and process.stderr is not None
        for stream in (process.stdin, process.stdout, process.stderr):
            os.set_blocking(stream.fileno(), False)
        if source:
            selector.register(process.stdin, selectors.EVENT_WRITE, 'stdin')
        else:
            process.stdin.close()
        selector.register(process.stdout, selectors.EVENT_READ, 'stdout')
        selector.register(process.stderr, selectors.EVENT_READ, 'stderr')
        sent = 0
        total = 0
        stdout = bytearray()
        while selector.get_map():
            check_work_budget()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise NativeParserError('The native parser exceeded its time deadline; use manual --lines selection.')
            for key, _events in selector.select(min(remaining, .1)):
                try:
                    if key.data == 'stdin':
                        count = os.write(key.fd, memoryview(source)[sent:sent + 65536])
                        sent += count
                        if sent == len(source):
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                    else:
                        chunk = os.read(key.fd, min(65536, MAX_OUTPUT_BYTES - total + 1))
                        if not chunk:
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                            continue
                        total += len(chunk)
                        charge_work_output(len(chunk))
                        if total > MAX_OUTPUT_BYTES:
                            raise NativeParserError('The native parser exceeded its combined output limit; use manual --lines selection.')
                        if key.data == 'stdout':
                            stdout.extend(chunk)
                except BlockingIOError:
                    continue
        while process.poll() is None:
            check_work_budget()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise NativeParserError('The native parser exceeded its time deadline; use manual --lines selection.')
            try:
                process.wait(timeout=min(remaining, .1))
            except subprocess.TimeoutExpired:
                continue
        check_work_budget()
        status = process.returncode
        if status:
            raise NativeParserError('The native parser failed within its isolation or resource limits; use manual --lines selection.')
        result = _reply(bytes(stdout), line_count)
        completed = True
        return result
    except OSError:
        raise NativeParserError('Could not exchange bounded native parser input/output; use manual --lines selection.') from None
    finally:
        # BaseException intentionally passes through: Ctrl-C/SystemExit retains
        # caller semantics after killing descendants and reaping the worker.
        if not completed:
            _kill_and_reap(process)
        if selector is not None:
            selector.close()
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None:
                stream.close()


def parse_native_functions(source: str, language: str) -> list[FunctionDefinition]:
    """Parse committed JS/TS text in a fresh, bounded optional worker."""
    if os.name != 'posix' or type(language) is not str or language not in LANGUAGES:
        raise NativeParserError(_ERRORS['unsupported'])
    if type(source) is not str or '\0' in source:
        raise NativeParserError(_ERRORS['syntax'])
    if len(source) > MAX_SOURCE_BYTES:
        raise NativeParserError(_ERRORS['complexity'])
    try:
        encoded = source.encode('utf-8')
    except UnicodeError:
        raise NativeParserError(_ERRORS['syntax']) from None
    if len(encoded) > MAX_SOURCE_BYTES:
        raise NativeParserError(_ERRORS['complexity'])
    # A trailing LF terminates the last physical line, rather than introducing
    # an extra selectable empty line. Unicode separators and CR do not count.
    lines = source.count('\n') + int(bool(source) and not source.endswith('\n'))
    return _run_worker(encoded, language, lines)


def parse_python_functions_isolated(source: str) -> list[FunctionDefinition]:
    """Resource-limit AST/tokenization without importing optional grammars."""
    if os.name != 'posix' or type(source) is not str or '\0' in source:
        raise NativeParserError('Bounded Python parsing requires POSIX isolation and valid source; use manual --lines selection.')
    try:
        encoded = source.encode('utf-8')
    except UnicodeError:
        raise NativeParserError('Invalid Python source; use manual --lines selection.') from None
    if len(encoded) > MAX_SOURCE_BYTES:
        raise NativeParserError(_ERRORS['complexity'])
    lines = source.count('\n') + int(bool(source) and not source.endswith('\n'))
    try:
        return _run_worker(encoded, 'python-ast', lines)
    except NativeParserError:
        raise NativeParserError('Python source could not be parsed within the syntax/resource limits; use manual --lines selection.') from None
