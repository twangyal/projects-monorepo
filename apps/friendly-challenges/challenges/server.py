"""Bounded loopback HTTP transport for the authoritative challenge Store."""
import fcntl
import http.client
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import socket
import stat
import threading
import time

from .store import DomainError, Store
from .images import MAX_IMAGE_BYTES
from .image_export import render_image_export

MAX_JSON = 16 * 1024
MAX_RESPONSE = 1024 * 1024
MAX_IMAGE_BODY = 16 + MAX_JSON + MAX_IMAGE_BYTES
MAX_STATIC = 8 * 1024 * 1024
HEADER_BYTES = 16 * 1024
SOCKET_TIMEOUT = 5
HEADER_TIMEOUT = 15
BODY_TIMEOUT = 15
MAX_CONNECTIONS = 16
ID = r'[0-9a-f]{32}'
TOKEN = re.compile(r'[0-9a-f]{64}\Z')
ACTIONS = {'terms', 'invite', 'accept', 'decline', 'withdraw', 'evidence', 'result', 'result/respond',
           'void', 'void/confirm', 'arbiter/nominate', 'arbiter/respond', 'arbiter/withdraw', 'arbiter/decide'}
ERROR_CODES = {'invalid_request', 'unauthorized', 'forbidden', 'not_found', 'conflict', 'limit', 'internal_error', 'too_large', 'timeout', 'busy'}


class ChallengeServer(HTTPServer):
    request_queue_size = 32

    def __init__(self, data_dir, port, dist_dir, now):
        if type(port) is not int or not 0 <= port <= 65535:
            raise ValueError('Port must be an integer from 0 through 65535.')
        self.data_dir = Path(data_dir).absolute()
        self.dist_dir = Path(dist_dir or Path(__file__).resolve().parents[1] / 'dist').absolute()
        self.store = None
        self._data_lock = None
        self._closed = False
        self._closing = False
        self._guard = threading.Lock()
        self._slots = threading.BoundedSemaphore(MAX_CONNECTIONS)
        self._handlers = {}
        if self.data_dir.is_symlink():
            raise RuntimeError('The data directory must not be a symbolic link.')
        self.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor = os.open(self.data_dir / '.server.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        try:
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise RuntimeError('The service lock must be a regular file.')
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise RuntimeError('Data directory is already in use by another Friendly Challenges service.') from None
        except BaseException:
            os.close(descriptor)
            raise
        self._data_lock = descriptor
        try:
            for name in ('challenges.sqlite3', 'challenges.sqlite3-wal', 'challenges.sqlite3-shm', 'challenges.sqlite3-journal'):
                if (self.data_dir / name).is_symlink():
                    raise RuntimeError('Database files must not be symbolic links.')
            self.store = Store(self.data_dir) if now is None else Store(self.data_dir, clock=now)
            super().__init__(('127.0.0.1', port), Handler)
        except BaseException:
            self.server_close()
            raise

    def process_request(self, request, client_address):
        with self._guard:
            admitted = not self._closing and self._slots.acquire(blocking=False)
            if admitted:
                thread = threading.Thread(target=self._serve_request, args=(request, client_address),
                                          name='friendly-challenges-http', daemon=True)
                self._handlers[thread] = request
                try:
                    thread.start()
                except BaseException:
                    self._handlers.pop(thread)
                    self._slots.release()
                    self.shutdown_request(request)
                    raise
                return
        # Overload handling never opens the Store or allocates another thread.
        body = b'{"error":"The service is busy. Try again shortly.","code":"busy"}'
        try:
            request.settimeout(.2)
            request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\n'
                            b'Connection: close\r\nCache-Control: no-store\r\nContent-Length: '
                            + str(len(body)).encode() + b'\r\n\r\n' + body)
        except OSError:
            pass
        finally:
            self.shutdown_request(request)

    def _serve_request(self, request, address):
        try:
            self.finish_request(request, address)
        except Exception:
            self.handle_error(request, address)
        finally:
            self.shutdown_request(request)
            with self._guard:
                self._handlers.pop(threading.current_thread(), None)
                self._slots.release()

    def handle_error(self, request, client_address):
        # Default http.server diagnostics may print request data or capabilities.
        pass

    def server_close(self):
        with self._guard:
            if self._closed:
                return
            self._closing = True
            handlers = list(self._handlers.items())
        if hasattr(self, 'socket'):
            super().server_close()
        for _, connection in handlers:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        deadline = time.monotonic() + 20
        for thread, _ in handlers:
            thread.join(max(0, deadline - time.monotonic()))
        if any(thread.is_alive() for thread, _ in handlers):
            raise RuntimeError('An active request did not stop; its data directory remains locked.')
        try:
            if self.store is not None:
                self.store.close()
        finally:
            if self._data_lock is not None:
                fcntl.flock(self._data_lock, fcntl.LOCK_UN)
                os.close(self._data_lock)
                self._data_lock = None
            self._closed = True


def create_server(data_dir: Path, port: int = 8767, *, dist_dir: Path | None = None, now=None) -> ChallengeServer:
    return ChallengeServer(data_dir, port, dist_dir, now)


class _HeaderDeadlineReader:
    """Bound the complete request line + headers, including continuously arriving bytes."""

    def __init__(self, stream, connection):
        self.stream = stream
        self.connection = connection
        self.deadline = time.monotonic() + HEADER_TIMEOUT

    def readline(self, limit=-1):
        line = bytearray()
        while limit < 0 or len(line) < limit:
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Request headers timed out.')
            self.connection.settimeout(min(SOCKET_TIMEOUT, remaining))
            # BufferedReader.readline may perform arbitrarily many socket reads,
            # each resetting the socket inactivity timeout. One-byte read1 owns
            # at most one read and cannot consume any following request body.
            byte = self.stream.read1(1)
            if not byte:
                break
            line.extend(byte)
            if byte == b'\n':
                break
        return bytes(line)

    def __getattr__(self, name):
        # Body reads and stream cleanup retain BufferedReader behavior. The
        # body already has its own independent inactivity/total deadlines.
        return getattr(self.stream, name)


class _HeaderLimit:
    def __init__(self, stream):
        self.stream = stream
        self.remaining = HEADER_BYTES

    def readline(self, limit=-1):
        size = self.remaining + 1 if limit < 0 else min(limit, self.remaining + 1)
        line = self.stream.readline(size)
        self.remaining -= len(line)
        if self.remaining < 0:
            raise http.client.LineTooLong('headers')
        return line


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'FriendlyChallenges'
    sys_version = ''

    def setup(self):
        super().setup()
        self.connection.settimeout(SOCKET_TIMEOUT)
        self.rfile = _HeaderDeadlineReader(self.rfile, self.connection)

    def log_message(self, *args):
        pass

    def parse_request(self):
        stream = self.rfile
        self.rfile = _HeaderLimit(stream)
        try:
            return super().parse_request()
        finally:
            self.rfile = stream
            self.connection.settimeout(SOCKET_TIMEOUT)

    def handle_expect_100(self):
        self._problem(417, 'invalid_request', 'Expect headers are not supported.')
        return False

    def send_error(self, code, message=None, explain=None):
        status = 405 if code == 501 else code
        self._problem(status, 'invalid_request', 'Unsupported method or malformed HTTP request.')

    def do_GET(self):
        self.close_connection = True
        try:
            self._security()
            self._route()
        except DomainError as error:
            if error.code not in ERROR_CODES:
                self._problem(500, 'internal_error', 'The request could not be completed.')
            else:
                self._problem(error.status, error.code, error.message[:400])
        except (TimeoutError, socket.timeout):
            self._problem(408, 'timeout', 'The request timed out. Try again.')
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self._problem(500, 'internal_error', 'The request could not be completed.')

    do_HEAD = do_GET
    do_POST = do_GET
    do_PUT = do_GET
    do_DELETE = do_GET
    do_OPTIONS = do_GET
    do_TRACE = do_GET
    do_PATCH = do_GET

    def _security(self):
        hosts = self.headers.get_all('Host', [])
        origins = self.headers.get_all('Origin', [])
        allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        if (len(hosts) != 1 or hosts[0] not in allowed or len(origins) > 1
                or (origins and origins[0] != 'http://' + hosts[0])
                or self.headers.get('Sec-Fetch-Site') == 'cross-site'):
            raise DomainError('forbidden', 'Only requests from this local Friendly Challenges service are allowed.', 403)
        if len(self.headers.get_all('Authorization', [])) > 1:
            raise DomainError('invalid_request', 'Use exactly one Authorization header.', 400)
        if self.command not in ('GET', 'HEAD', 'POST'):
            raise DomainError('invalid_request', 'This HTTP method is not supported.', 405)
        link = self.command in ('GET', 'HEAD') and re.fullmatch(r'/\?challenge=' + ID, self.path)
        if ('?' in self.path and not link) or '#' in self.path:
            raise DomainError('invalid_request', 'Only the supported challenge link query is accepted.', 400)
        if len(self.path) > 2048:
            raise DomainError('not_found', 'Route not found.', 404)
        if self.headers.get_all('Transfer-Encoding'):
            raise DomainError('invalid_request', 'Transfer encoding is not supported.', 400)
        lengths = self.headers.get_all('Content-Length', [])
        if lengths and (len(lengths) != 1 or not re.fullmatch(r'[0-9]{1,10}', lengths[0])):
            raise DomainError('invalid_request', 'Use one valid Content-Length header.', 400)
        if self.command in ('GET', 'HEAD') and lengths and int(lengths[0]) != 0:
            raise DomainError('invalid_request', 'GET and HEAD requests cannot contain a body.', 400)

    def _headers(self, status, content_type, size, extra=None):
        self.send_response(status)
        for name, value in {
            'Content-Type': content_type, 'Content-Length': str(size), 'Connection': 'close',
            'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
            **(extra or {}),
        }.items():
            self.send_header(name, value)
        self.end_headers()

    def _json(self, status, value, extra=None):
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
        if len(encoded) > MAX_RESPONSE:
            raise DomainError('too_large', 'The response exceeds the supported record limit.', 413)
        self._headers(status, 'application/json; charset=utf-8', len(encoded), extra)
        if getattr(self, 'command', None) != 'HEAD':
            self.wfile.write(encoded)

    def _problem(self, status, code, message):
        self.close_connection = True
        try:
            self._json(status, {'error': message, 'code': code})
        except OSError:
            pass

    def _body(self, maximum, content_type):
        values = self.headers.get_all('Content-Length', [])
        if len(values) != 1 or not re.fullmatch(r'[0-9]{1,10}', values[0]):
            raise DomainError('invalid_request', 'Use one valid Content-Length header.', 400)
        size = int(values[0])
        if size > maximum:
            raise DomainError('too_large', 'The request exceeds its supported byte limit.', 413)
        types = self.headers.get_all('Content-Type', [])
        if len(types) != 1 or types[0].split(';', 1)[0].strip().lower() != content_type:
            raise DomainError('invalid_request', 'Use the supported request content type.', 400)
        deadline = time.monotonic() + BODY_TIMEOUT
        body = bytearray()
        while size:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            self.connection.settimeout(min(SOCKET_TIMEOUT, remaining))
            chunk = self.rfile.read1(min(size, 4096))
            if not chunk:
                raise DomainError('invalid_request', 'The request body ended early.', 400)
            body.extend(chunk)
            size -= len(chunk)
        return bytes(body)

    def _object(self):
        return self._decode_object(self._body(MAX_JSON, 'application/json'))

    def _decode_object(self, body):
        def pairs(items):
            result = {}
            for key, value in items:
                if key in result:
                    raise ValueError()
                result[key] = value
            return result
        def constant(value):
            raise ValueError()
        def validate(value, depth=0):
            if depth > 32 or isinstance(value, float) and not math.isfinite(value):
                raise ValueError()
            if isinstance(value, dict):
                for child in value.values():
                    validate(child, depth + 1)
            elif isinstance(value, list):
                for child in value:
                    validate(child, depth + 1)
        try:
            result = json.loads(body.decode('utf-8'), object_pairs_hook=pairs, parse_constant=constant)
            if type(result) is not dict:
                raise ValueError()
            validate(result)
            return result
        except (ValueError, UnicodeError, RecursionError):
            raise DomainError('invalid_request', 'Supply a valid UTF-8 JSON object with unique fields and finite values.', 400) from None

    def _image_object(self):
        body = self._body(MAX_IMAGE_BODY, 'application/octet-stream')
        if len(body) < 16 or body[:8] != b'FCEVID01':
            raise DomainError('invalid_request', 'Supply a complete supported image evidence request.', 400)
        metadata_size = int.from_bytes(body[8:12], 'little')
        image_size = int.from_bytes(body[12:16], 'little')
        if metadata_size > MAX_JSON or image_size > MAX_IMAGE_BYTES:
            raise DomainError('too_large', 'The image evidence request exceeds its supported limits.', 413)
        if (not metadata_size or not image_size
                or len(body) != 16 + metadata_size + image_size):
            raise DomainError('invalid_request', 'Image evidence framing must match its exact contents.', 400)
        return self._decode_object(body[16:16 + metadata_size]), body[16 + metadata_size:]

    def _binary(self, value, content_type, extra=None):
        self._headers(200, content_type, len(value), extra)
        self.wfile.write(value)

    def _token(self):
        header = self.headers.get('Authorization', '')
        token = header[7:] if header.startswith('Bearer ') else ''
        if not TOKEN.fullmatch(token):
            raise DomainError('unauthorized', 'A valid participant Bearer capability is required.', 401)
        return token

    def _route(self):
        method, path, store = self.command, self.path, self.server.store
        if path == '/api/status' and method in ('GET', 'HEAD'):
            return self._json(200, {'schemaVersion': 1, 'maxChallenges': 20})
        if path == '/api/challenges' and method == 'POST':
            return self._json(201, store.create(self._object()))
        media = re.fullmatch(r'/api/challenges/(' + ID + r')/evidence/(' + ID + r')/image', path)
        if media and method == 'GET':
            challenge_id, evidence_id = media.groups()
            return self._binary(store.image(challenge_id, self._token(), evidence_id), 'image/jpeg')
        match = re.fullmatch(r'/api/challenges/(' + ID + r')(?:/([a-z/]+))?', path)
        if match:
            challenge_id, action = match.groups()
            if method == 'HEAD':
                raise DomainError('invalid_request', 'HEAD is supported only for static files and status.', 405)
            if action in ('join', 'arbiter/join') and method == 'POST':
                claim = store.join if action == 'join' else store.join_arbiter
                return self._json(200, claim(challenge_id, self._object()))
            if action is None and method == 'GET':
                return self._json(200, store.get(challenge_id, self._token()))
            if action == 'export' and method == 'GET':
                return self._json(200, store.export(challenge_id, self._token()),
                                  {'Content-Disposition': f'attachment; filename="friendly-challenge-{challenge_id}.json"'})
            if action == 'evidence/image' and method == 'POST':
                token = self._token()
                # Reject an unauthorized seat before decoding or accepting the
                # larger body. Store reauthenticates inside the commit too.
                store.get(challenge_id, token)
                payload, image = self._image_object()
                return self._json(200, store.add_image(challenge_id, token, payload, image))
            if action == 'export/images' and method == 'GET':
                public_record, images = store.export_images(challenge_id, self._token())
                report = render_image_export(public_record, images)
                return self._binary(report, 'text/html; charset=utf-8', {
                    'Content-Disposition': f'attachment; filename="friendly-challenge-{challenge_id}-images.html"',
                    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
                })
            if action in ACTIONS and method == 'POST':
                token = self._token()
                return self._json(200, store.command(challenge_id, token, action, self._object()))
        if method in ('GET', 'HEAD') and not path.startswith('/api/'):
            return self._static()
        raise DomainError('not_found', 'Route not found.', 404)

    def _static(self):
        if self.path == '/' or re.fullmatch(r'/\?challenge=' + ID, self.path):
            parts = ['index.html']
        elif re.fullmatch(r'/assets/[A-Za-z0-9][A-Za-z0-9_.-]{0,160}\.(?:js|css|svg|png|jpe?g|webp|ico|woff2)', self.path):
            parts = self.path[1:].split('/')
        else:
            raise DomainError('not_found', 'File not found.', 404)
        directories = []
        try:
            parent = os.open(self.server.dist_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            directories.append(parent)
            for part in parts[:-1]:
                parent = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
                directories.append(parent)
            descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            stream = os.fdopen(descriptor, 'rb')
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_STATIC:
                stream.close()
                raise OSError()
        except OSError:
            raise DomainError('not_found', 'File not found. Build the frontend before opening the app.', 404) from None
        finally:
            for descriptor in reversed(directories):
                os.close(descriptor)
        with stream:
            self._headers(200, mimetypes.guess_type(parts[-1])[0] or 'application/octet-stream', info.st_size)
            if self.command != 'HEAD':
                remaining = info.st_size
                while remaining:
                    chunk = stream.read(min(remaining, 65536))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
