"""Fixed isolated entrypoint: limits precede optional grammar imports."""
from __future__ import annotations

import json
from pathlib import Path
import runpy
import sys


def _emit(value: dict) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(',', ':')) + '\n')
    sys.stdout.flush()


def main() -> None:
    try:
        import resource
        # Load only the fixed trusted constants file without adding any path to
        # imports. Source text and inspected repository configuration never
        # supply this location. Native imports happen after all four limits.
        protocol = runpy.run_path(str(Path(__file__).resolve().with_name('native_protocol.py')))
        resource.setrlimit(resource.RLIMIT_AS, (protocol['ADDRESS_SPACE_BYTES'],) * 2)
        resource.setrlimit(resource.RLIMIT_CPU, protocol['CPU_SECONDS'])
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    except (ImportError, OSError, ValueError, KeyError):
        _emit({'error': 'unsupported'})
        return
    # -I deliberately excludes the script directory. Add exactly the fixed
    # installed package parent after isolation, never a repository/cwd path.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from git_history.native_protocol import ERROR_CODES, LANGUAGES, MAX_SOURCE_BYTES
    if len(sys.argv) != 2 or sys.argv[1] not in LANGUAGES:
        _emit({'error': 'unsupported'})
        return
    try:
        data = sys.stdin.buffer.read(MAX_SOURCE_BYTES + 1)
        if len(data) > MAX_SOURCE_BYTES:
            _emit({'error': 'complexity'})
            return
        source = data.decode('utf-8')
        if '\0' in source:
            _emit({'error': 'syntax'})
            return
        from git_history.native_syntax import NativeSyntaxError, parse_native
        try:
            functions = parse_native(source, sys.argv[1])
        except NativeSyntaxError as error:
            code = error.code if error.code in ERROR_CODES else 'unsupported'
            _emit({'error': code})
            return
        _emit({'functions': [
            {'qualified_name': item.qualified_name, 'start_line': item.start_line,
             'end_line': item.end_line, 'kind': item.kind}
            for item in functions
        ]})
    except UnicodeError:
        _emit({'error': 'syntax'})
    except (MemoryError, RecursionError, OverflowError):
        _emit({'error': 'complexity'})
    except ImportError:
        _emit({'error': 'dependencies'})
    except Exception:
        # A native/API/isolation failure must not quote source or diagnostics.
        _emit({'error': 'unsupported'})


if __name__ == '__main__':
    main()
