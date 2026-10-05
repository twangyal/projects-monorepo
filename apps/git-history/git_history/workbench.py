"""Authenticated loopback-only, read-only committed-source workbench."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
import io
import json
import math
from pathlib import Path
import re
import secrets
import socket
from socketserver import ThreadingMixIn
import threading
import time

from .work_budget import (
    WorkBudgetError, WorkCancelled, check_work_budget, work_budget,
)

MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
MAX_HEADER_BYTES = 64 * 1024
MAX_HANDLERS = 8
_REVISION = re.compile(r'(?:[0-9a-f]{40}|[0-9a-f]{64})\Z')
_CSP = ("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "connect-src 'self'; frame-src 'self' blob:; img-src 'self' data:; "
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")


class _ActionableError(ValueError):
    """Trusted validation text, never raw Git diagnostics or unknown failures."""


def _encode(value: object) -> bytes:
    raw = json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(',', ':')).encode('utf-8')
    if len(raw) > MAX_RESPONSE_BYTES:
        raise _ActionableError('The API response exceeds its 32 MiB limit; narrow the selection.')
    return raw


def _keys(value: object, expected: set[str]) -> dict:
    if type(value) is not dict or set(value) != expected:
        raise ValueError('Invalid request fields.')
    return value


def _text(value: object, maximum: int, *, empty: bool = False) -> str:
    if type(value) is not str or (not empty and not value) or '\0' in value:
        raise ValueError('Invalid text field.')
    try:
        if len(value.encode('utf-8')) > maximum:
            raise ValueError('Text field exceeds its limit.')
    except UnicodeError:
        raise ValueError('Text must be valid UTF-8.') from None
    return value


def _integer(value: object, low: int, high: int) -> int:
    if type(value) is not int or not low <= value <= high:
        raise ValueError('Invalid integer field.')
    return value


def _comparison_side(value: object) -> dict:
    side = _keys(value, {'revision', 'path', 'selection'})
    revision = _text(side['revision'], 64)
    if not _REVISION.fullmatch(revision):
        raise ValueError('Use the full immutable revision returned by discovery.')
    _text(side['path'], 4096)
    selection = side['selection']
    if type(selection) is not dict or type(selection.get('kind')) is not str:
        raise ValueError('Invalid comparison selection.')
    kind = selection['kind']
    if kind in ('whole', 'missing'):
        _keys(selection, {'kind'})
    elif kind == 'lines':
        _keys(selection, {'kind', 'start', 'end'})
        start = _integer(selection['start'], 1, 2 ** 31 - 1)
        end = _integer(selection['end'], start, 2 ** 31 - 1)
        if end - start + 1 > 200:
            raise ValueError('Select at most 200 lines.')
    elif kind == 'function':
        _keys(selection, {'kind', 'function'})
        _text(selection['function'], 8192)
    else:
        raise ValueError('Unsupported comparison selection.')
    return side


def _job_args(value: object) -> tuple[str, dict]:
    request = _keys(value, {'operation', 'args'})
    operation = request['operation']
    if type(operation) is not str or operation not in ('files', 'source', 'functions', 'report', 'comparison', 'changed-files'):
        raise ValueError('Unknown operation.')
    if operation == 'changed-files':
        args = _keys(request['args'], {'left_ref', 'right_ref', 'directory'})
        _text(args['left_ref'], 1024)
        _text(args['right_ref'], 1024)
        _text(args['directory'], 4096, empty=True)
    elif operation == 'comparison':
        args = _keys(request['args'], {'left', 'right'})
        _comparison_side(args['left'])
        _comparison_side(args['right'])
    elif operation == 'files':
        args = _keys(request['args'], {'ref', 'directory', 'language'})
        _text(args['ref'], 1024)
        _text(args['directory'], 4096, empty=True)
        if type(args['language']) is not str or args['language'] not in ('all', 'python', 'javascript', 'typescript'):
            raise ValueError('Unsupported language.')
    else:
        names = {'revision', 'path'} | ({'selection', 'max_commits', 'context'} if operation == 'report' else set())
        args = _keys(request['args'], names)
        revision = _text(args['revision'], 64)
        if not _REVISION.fullmatch(revision):
            raise ValueError('Use the full immutable revision returned by discovery.')
        _text(args['path'], 4096)
        if operation == 'report':
            selection = args['selection']
            if type(selection) is not dict:
                raise ValueError('Invalid selection.')
            if set(selection) == {'function'}:
                _text(selection['function'], 8192)
            elif set(selection) == {'start', 'end'}:
                start = _integer(selection['start'], 1, 2 ** 31 - 1)
                end = _integer(selection['end'], start, 2 ** 31 - 1)
                if end - start + 1 > 200:
                    raise ValueError('Select at most 200 lines.')
            else:
                raise ValueError('Select either a function or a line range.')
            _integer(args['max_commits'], 1, 50)
            if args['context'] is not None:
                _text(args['context'], 256 * 1024)
    return operation, args


def _parse_json(raw: bytes) -> object:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON field.')
            result[key] = value
        return result

    def invalid(_value):
        raise ValueError('Nonfinite JSON value.')

    try:
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=unique, parse_constant=invalid)
        stack = [(value, 0)]
        while stack:
            item, depth = stack.pop()
            if depth > 64:
                raise ValueError('JSON nesting exceeded.')
            if type(item) is str:
                item.encode('utf-8')
            elif type(item) is float and not math.isfinite(item):
                raise ValueError('Nonfinite JSON value.')
            elif type(item) is dict:
                stack.extend((key, depth + 1) for key in item)
                stack.extend((child, depth + 1) for child in item.values())
            elif type(item) is list:
                stack.extend((child, depth + 1) for child in item)
        return value
    except (ValueError, UnicodeError, RecursionError, OverflowError):
        raise ValueError('Supply valid UTF-8 JSON with unique fields and finite values.') from None


def _execute_operation(repo: Path, operation: str, args: dict) -> object:
    """Real read-only operation boundary, also usable for controlled test fixtures."""
    from .context import ContextRecords, parse_context
    from .reader import ReaderError, inspect_repository, list_files, list_functions, read_source
    from .render import render_html, render_json

    def read(callback, *arguments, **keywords):
        try:
            return callback(*arguments, **keywords)
        except ReaderError as error:
            raise _ActionableError(str(error)) from None

    def validated(function, *arguments):
        # These exact context/render APIs issue bounded validation messages.
        # Do not apply this wrapper to arbitrary operations or Git subprocesses.
        try:
            return function(*arguments)
        except ValueError as error:
            raise _ActionableError(str(error)) from None

    check_work_budget()
    if operation == 'changed-files':
        from .changed_files import list_changed_files, render_changed_files_json

        catalog = read(list_changed_files, repo, args['left_ref'], args['right_ref'],
                       directory=args['directory'])
        check_work_budget()
        # The public serializer is the single catalog validation/byte authority.
        result = json.loads(validated(render_changed_files_json, catalog))
    elif operation == 'comparison':
        from .comparison import CompareSelection, CompareTarget, compare_repository
        from .comparison_render import render_comparison_html, render_comparison_json

        def target(side):
            return CompareTarget(side['revision'], side['path'], CompareSelection(**side['selection']))

        report = read(compare_repository, repo, target(args['left']), target(args['right']))
        check_work_budget()
        html = validated(render_comparison_html, report)
        check_work_budget()
        result = {'html': html, 'json': validated(render_comparison_json, report)}
    elif operation == 'files':
        result = asdict(read(list_files, repo, ref=args['ref'], directory=args['directory'], language=args['language']))
    elif operation == 'source':
        result = asdict(read(read_source, repo, args['path'], args['revision']))
    elif operation == 'functions':
        result = asdict(read(list_functions, repo, args['path'], ref=args['revision']))
    else:
        selection = args['selection']
        report = read(inspect_repository, repo, args['path'], selection.get('start'), selection.get('end'),
                      ref=args['revision'], function=selection.get('function'), max_commits=args['max_commits'])
        check_work_budget()
        context = validated(parse_context, args['context'], report) if args['context'] is not None else None
        if isinstance(context, ContextRecords):
            report.supplied_context = context
            context = None
        check_work_budget()
        html = validated(render_html, report, context)
        check_work_budget()
        result = {'html': html, 'json': validated(render_json, report, context)}
    check_work_budget()
    return result


@dataclass
class _Job:
    id: str
    cancel: threading.Event
    state: str = 'pending'
    reply: bytes | None = None


class _HeaderLimit(ValueError):
    pass


class _DeadlineReader(io.RawIOBase):
    """Unbuffered socket deadline updated after every read, including drip feeds."""
    def __init__(self, connection: socket.socket, deadline: float):
        super().__init__()
        self.connection = connection
        self.deadline = deadline
        self.buffer = bytearray()
        self.header_bytes = 0

    def _receive(self) -> bytes:
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Request deadline.')
        self.connection.settimeout(remaining)
        return self.connection.recv(4096)

    def readline(self, size: int = -1) -> bytes:
        limit = MAX_HEADER_BYTES + 1 if size < 0 else min(size, MAX_HEADER_BYTES + 1)
        while True:
            newline = self.buffer.find(b'\n', 0, limit)
            if newline >= 0 or len(self.buffer) >= limit:
                length = newline + 1 if newline >= 0 else limit
                result = bytes(self.buffer[:length])
                del self.buffer[:length]
                self.header_bytes += len(result)
                if self.header_bytes > MAX_HEADER_BYTES:
                    raise _HeaderLimit('Headers exceeded.')
                return result
            chunk = self._receive()
            if not chunk:
                result = bytes(self.buffer)
                self.buffer.clear()
                return result
            self.buffer.extend(chunk)

    def read(self, size: int = -1) -> bytes:
        if size < 0 or size > MAX_REQUEST_BYTES:
            raise ValueError('Invalid bounded body read.')
        result = bytearray()
        while len(result) < size:
            if self.buffer:
                count = min(len(self.buffer), size - len(result))
                result.extend(self.buffer[:count])
                del self.buffer[:count]
            else:
                chunk = self._receive()
                if not chunk:
                    break
                self.buffer.extend(chunk)
        if time.monotonic() >= self.deadline:
            raise TimeoutError('Request deadline.')
        return bytes(result)


class _Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'GitHistory'
    sys_version = ''

    def setup(self):
        super().setup()
        self.rfile.close()
        self.rfile = _DeadlineReader(self.connection, time.monotonic() + self.server.request_timeout)

    def log_message(self, _format, *args):
        pass

    def handle_expect_100(self):
        # Authenticate before any body permission or read.
        return True

    def _security_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Security-Policy', _CSP)
        self.send_header('Connection', 'close')

    def _reply(self, status: int, raw: bytes, content_type: str = 'application/json; charset=utf-8'):
        self.close_connection = True
        self.send_response(status)
        self._security_headers()
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(raw)

    def send_error(self, code, message=None, explain=None):
        self._reply(code, _encode({'error': 'The request was rejected.'}))

    def _reject(self, code: int, message: str):
        self._reply(code, _encode({'error': message}))

    def handle_one_request(self):
        self.close_connection = True
        self.request_version = 'HTTP/1.0'
        self.command = None
        try:
            self.raw_requestline = self.rfile.readline(8193)
            if not self.raw_requestline:
                return
            if len(self.raw_requestline) > 8192:
                self.send_error(414)
                return
            if not self.parse_request():
                return
            self.close_connection = True
            self._route()
            self.wfile.flush()
        except _HeaderLimit:
            self.send_error(431)
        except TimeoutError:
            self.send_error(408)
        except (BrokenPipeError, ConnectionError, OSError):
            pass
        except Exception:
            # No request content, token, repository path or traceback escapes.
            self._reject(500, 'The request could not be completed.')

    def _one(self, name: str) -> str | None:
        values = self.headers.get_all(name, [])
        if len(values) > 1:
            raise ValueError('Duplicate request header.')
        return values[0] if values else None

    def _route(self):
        try:
            host = self._one('Host')
            origin = self._one('Origin')
            token = self._one('X-Git-History-Token')
            site = self._one('Sec-Fetch-Site')
            length = self._one('Content-Length')
            content_type = self._one('Content-Type')
            if self.headers.get_all('Transfer-Encoding') or self.headers.get_all('Expect'):
                raise ValueError('Unsupported request framing.')
            if length is not None and (not re.fullmatch(r'[0-9]+', length) or len(length) > 10):
                raise ValueError('Invalid request framing.')
            size = int(length) if length is not None else 0
        except ValueError:
            self._reject(400, 'Invalid request framing or duplicate headers.')
            return
        if host != self.server.origin.removeprefix('http://') or site not in (None, 'none', 'same-origin', 'same-site'):
            self._reject(403, 'This service accepts only its exact loopback origin.')
            return
        if self.command != 'POST' and size:
            self._reject(400, 'Unexpected request body.')
            return
        if self.path not in ('/', '/workbench.js', '/workbench.css', '/context-editor.js', '/changed-files.js',
                             '/api/session', '/api/jobs', '/api/result', '/api/cancel'):
            self._reject(404, 'Unknown route.')
            return
        if not self.path.startswith('/api/'):
            if self.command != 'GET':
                self._reject(405, 'Use GET for this asset.')
                return
            name, mime = {'/': ('workbench.html', 'text/html; charset=utf-8'),
                          '/workbench.js': ('workbench.js', 'text/javascript; charset=utf-8'),
                          '/context-editor.js': ('context-editor.js', 'text/javascript; charset=utf-8'),
                          '/changed-files.js': ('changed-files.js', 'text/javascript; charset=utf-8'),
                          '/workbench.css': ('workbench.css', 'text/css; charset=utf-8')}[self.path]
            try:
                raw = (Path(__file__).resolve().parent / 'web' / name).read_bytes()
            except OSError:
                self._reject(503, 'Packaged workbench assets are unavailable.')
                return
            self._reply(200, raw, mime)
            return
        if self.command != 'POST':
            self._reject(405, 'Use POST for workbench API calls.')
            return
        if (origin != self.server.origin or token is None or not re.fullmatch(r'[0-9a-f]{64}', token)
                or not secrets.compare_digest(token, self.server.token)):
            self._reject(403, 'Reopen the session URL printed in the terminal.')
            return
        if length is None:
            self._reject(400, 'Content-Length is required.')
            return
        if size > MAX_REQUEST_BYTES:
            self._reject(413, 'The request exceeds 2 MiB.')
            return
        if content_type is None or not re.fullmatch(r'application/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?', content_type, re.I):
            self._reject(415, 'Use UTF-8 application/json.')
            return
        raw = self.rfile.read(size)
        if len(raw) != size:
            self._reject(400, 'Incomplete request body.')
            return
        try:
            value = _parse_json(raw)
            if self.path == '/api/session':
                _keys(value, set())
                status, reply = 200, _encode({'repo_name': self.server.repo_name})
            elif self.path == '/api/jobs':
                operation, args = _job_args(value)
                status, reply = self.server.start_job(operation, args)
            else:
                request = _keys(value, {'id'})
                job_id = _text(request['id'], 128)
                status, reply = self.server.job_reply(job_id, self.path == '/api/cancel')
        except ValueError:
            self._reject(400, 'Invalid JSON request or operation arguments.')
            return
        self._reply(status, reply)


class WorkbenchServer(ThreadingMixIn, HTTPServer):
    """Eight bounded handlers and one cancellable, joined read-only job."""
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, repo: Path, repo_name: str, port: int, job_timeout: float, request_timeout: float):
        self.repo = repo
        self.repo_name = repo_name
        self.token = secrets.token_hex(32)
        self.job_timeout = job_timeout
        self.request_timeout = request_timeout
        self._lock = threading.Lock()
        self._job: _Job | None = None
        self.active_thread: threading.Thread | None = None
        self._closed = False
        self._slots = threading.BoundedSemaphore(MAX_HANDLERS)
        self._connections: set[socket.socket] = set()
        self._handlers: set[threading.Thread] = set()
        super().__init__(('127.0.0.1', port), _Handler)
        self.origin = f'http://127.0.0.1:{self.server_port}'
        self.url = self.origin + '/#session=' + self.token

    def handle_error(self, request, client_address):
        pass

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            raw = _encode({'error': 'The service is busy; try again.'})
            headers = (f'HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json; charset=utf-8\r\n'
                       f'Content-Length: {len(raw)}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n'
                       f'Referrer-Policy: no-referrer\r\nX-Frame-Options: DENY\r\nContent-Security-Policy: {_CSP}\r\nConnection: close\r\n\r\n').encode('ascii')
            try:
                request.settimeout(.2)
                request.sendall(headers + raw)
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        with self._lock:
            self._connections.add(request)
        try:
            super().process_request(request, client_address)
        except BaseException:
            with self._lock:
                self._connections.discard(request)
            self._slots.release()
            self.shutdown_request(request)
            raise

    def process_request_thread(self, request, client_address):
        current = threading.current_thread()
        with self._lock:
            self._handlers.add(current)
        try:
            super().process_request_thread(request, client_address)
        finally:
            with self._lock:
                self._handlers.discard(current)
                self._connections.discard(request)
            self._slots.release()

    def start_job(self, operation: str, args: dict) -> tuple[int, bytes]:
        with self._lock:
            if self._closed or (self.active_thread is not None and self.active_thread.is_alive()):
                return 409, _encode({'error': 'A job is still active; wait for cleanup.'})
            job = _Job(secrets.token_hex(16), threading.Event())
            self._job = job
            self.active_thread = threading.Thread(target=self._run_job, args=(job, operation, args), name='git-history-workbench-job')
            self.active_thread.start()
            return 202, _encode({'id': job.id})

    def _run_job(self, job: _Job, operation: str, args: dict):
        try:
            with work_budget(self.job_timeout, job.cancel):
                check_work_budget()
                result = _execute_operation(self.repo, operation, args)
                check_work_budget()
                reply = _encode({'id': job.id, 'state': 'complete', 'result': result})
                check_work_budget()
                with self._lock:
                    check_work_budget()
                    job.reply = reply
                    job.state = 'complete'
        except WorkCancelled:
            self._finish_error(job, 'cancelled', None)
        except WorkBudgetError as error:
            self._finish_error(job, 'error', str(error))
        except _ActionableError as error:
            self._finish_error(job, 'error', str(error))
        except Exception:
            self._finish_error(job, 'error', 'The operation failed. Check the ref, path, selection or supplied context. '
                               'Use manual lines if function parsing is unavailable; JavaScript/TypeScript needs the optional javascript extra.')

    def _finish_error(self, job: _Job, state: str, error: str | None):
        with self._lock:
            # A cancellation arriving before publication wins, even if the
            # underlying bounded stage happened to fail at the same time.
            if job.cancel.is_set():
                state, error = 'cancelled', None
            value = {'id': job.id, 'state': state}
            if error is not None:
                value['error'] = error
            job.reply = _encode(value)
            job.state = state

    def job_reply(self, job_id: str, cancel: bool) -> tuple[int, bytes]:
        with self._lock:
            job = self._job
            if job is None or job.id != job_id:
                return 404, _encode({'error': 'Unknown or expired job.'})
            worker_active = self.active_thread is not None and self.active_thread.is_alive()
            if job.state != 'pending' and worker_active:
                # Terminal publication and busy-slot release must be observed
                # together. Even context cleanup/thread return is finished
                # before a client can use terminal polling to replace work.
                state = 'cancelling' if cancel else 'pending'
                return 200, _encode({'id': job.id, 'state': state})
            if cancel:
                state = job.state
                if state == 'pending':
                    job.cancel.set()
                    state = 'cancelling'
                return 200, _encode({'id': job.id, 'state': state})
            return 200, job.reply if job.reply is not None else _encode({'id': job.id, 'state': 'pending'})

    def _stop_job(self):
        with self._lock:
            self._closed = True
            if self._job is not None and self._job.state == 'pending':
                self._job.cancel.set()
            thread = self.active_thread
        if thread is not None and thread is not threading.current_thread():
            thread.join()

    def shutdown(self):
        self._stop_job()
        super().shutdown()

    def server_close(self):
        self._stop_job()
        with self._lock:
            connections = list(self._connections)
            handlers = list(self._handlers)
        for connection in connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        super().server_close()
        for handler in handlers:
            if handler is not threading.current_thread():
                handler.join()


def create_server(repo: str | Path, port: int = 0, *, job_timeout: float = 45.0,
                  request_timeout: float = 5.0) -> WorkbenchServer:
    """Validate one local repo and create an unstarted loopback service."""
    from .reader import _resolve_repository
    _integer(port, 0, 65535)
    for value, maximum in ((job_timeout, 45), (request_timeout, 5)):
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= maximum:
            raise ValueError('Invalid service time budget.')
    with work_budget():
        _git, root, _revision = _resolve_repository(repo, 'HEAD')
    return WorkbenchServer(root, root.name, port, job_timeout, request_timeout)
