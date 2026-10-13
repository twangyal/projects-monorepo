"""Loopback-only private room API and bounded, authenticated media delivery."""

import fcntl
from contextlib import contextmanager
from http.cookies import SimpleCookie, CookieError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import socket
from socketserver import TCPServer
import stat
import threading
import time
from urllib.parse import parse_qs, unquote, urlsplit
import uuid

from .jobs import JobManager
from .listening import ListeningStore
from .photos import EXTENSIONS, MAX_PHOTO_BYTES, PhotoError, inspect_photo
from .spotify import SpotifyClient, SpotifyError
from .store import DomainError, Store
from .transport import TransportConfig, validate_transport, matches_setup
from .https_server import HttpsRuntime, HeaderReader, DeadlineWriter, RequestError
from . import transport as transport_limits

MAX_UPLOAD = 25 * 1024 * 1024
MAX_JSON = 64 * 1024
MAX_MEDIA = 8 * 1024 * 1024
ID = r'[0-9a-f]{32}'
TOKEN = re.compile(r'[0-9a-f]{64}\Z')


def _directory(path):
    if path.is_symlink():
        raise RuntimeError('Data directories must not be symbolic links.')
    path.mkdir(parents=True, exist_ok=True)
    if not path.is_dir():
        raise RuntimeError('A data directory is unavailable.')


@contextmanager
def _child_directory(parent, name, *, create=False):
    if create:
        try:
            os.mkdir(name, mode=0o700, dir_fd=parent)
        except FileExistsError:
            pass
    descriptor = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    try:
        yield descriptor
    finally:
        os.close(descriptor)


def _cleanup_child(parent, name):
    """Delete only a named child of a verified directory; never follow links."""
    try:
        info = os.stat(name, dir_fd=parent, follow_symlinks=False)
    except FileNotFoundError:
        return
    if stat.S_ISDIR(info.st_mode):
        # Python's fd-based rmtree checks each directory's identity before
        # descending and unlinking, including replacements during traversal.
        shutil.rmtree(name, dir_fd=parent)
    else:
        os.unlink(name, dir_fd=parent)


class DuetServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def __init__(self, data_dir, port, dist_dir, normalize, *, transport=None, spotify=None, sync_seconds=600):
        if type(port) is not int or not 0 <= port <= 65535:
            raise ValueError('Port must be an integer between 0 and 65535.')
        self.data_dir = Path(data_dir).absolute()
        self.dist_dir = Path(dist_dir or Path(__file__).resolve().parents[1] / 'dist').resolve()
        self.work_dir = self.data_dir / '.jobs'
        self.media_dir = self.data_dir / 'media'
        self.normalize = normalize
        self.lock = threading.RLock()
        self.jobs = JobManager(self.lock)
        self.store = None
        self.listening = None
        # A SpotifyClient when the operator configured a Spotify app; listening features are off otherwise.
        self.spotify = spotify
        self.sync_seconds = sync_seconds
        self._sync_stop = threading.Event()
        self._sync_thread = None
        self._data_lock = None
        self._data_fd = None
        self._closed = False
        self.transport = transport
        self.https_runtime = None
        self.handler_connections = {}
        if transport is not None:
            validate_transport(transport, port)
        try:
            if transport is not None:
                self.request_queue_size = transport_limits.LISTEN_BACKLOG
                super().__init__((transport.bind, port), Handler)
            self._initialize_library(port)
            if transport is not None:
                self.https_runtime = HttpsRuntime(self, transport)
        except BaseException:
            self.server_close()
            raise

    def _initialize_library(self, port):
        _directory(self.data_dir)
        if not Path(f'/proc/{os.getpid()}/fd').is_dir() or not shutil.rmtree.avoids_symlink_attacks:
            raise RuntimeError('Duet requires Linux /proc descriptor paths and safe fd-based directory cleanup.')
        self._data_fd = os.open(self.data_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            descriptor = os.open('.server.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
                                 0o600, dir_fd=self._data_fd)
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                os.close(descriptor)
                raise RuntimeError('The data-directory lock must be a regular file.')
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            if 'descriptor' in locals():
                os.close(descriptor)
            os.close(self._data_fd)
            self._data_fd = None
            raise RuntimeError('Data directory is already in use by another Duet service.') from None
        except BaseException:
            os.close(self._data_fd)
            self._data_fd = None
            raise
        self._data_lock = descriptor
        try:
            with _child_directory(self._data_fd, '.jobs', create=True):
                pass
            with _child_directory(self._data_fd, 'media', create=True):
                pass
            with _child_directory(self._data_fd, 'photos', create=True):
                pass
            self.store = Store(self.data_dir)
            self.store.pause_all()
            self.listening = ListeningStore(self.data_dir)
            with _child_directory(self._data_fd, '.jobs') as work:
                for name in os.listdir(work):
                    if re.fullmatch(ID, name):
                        _cleanup_child(work, name)
            if self.transport is None:
                super().__init__(('127.0.0.1', port), Handler)
        except BaseException:
            self.server_close()
            raise
        if self.spotify is not None:
            self._sync_thread = threading.Thread(target=self._sync_loop, name='duet-spotify-sync', daemon=True)
            self._sync_thread.start()

    @property
    def redirect_uri(self):
        origin = self.transport.origin if self.transport else f'http://127.0.0.1:{self.server_port}'
        return f'{origin}/spotify/callback'

    def sync_room(self, room_id, *, force=False):
        for role in ('host', 'guest'):
            self.listening.sync(self.spotify, room_id, role, force=force)

    def _sync_loop(self):
        # Automatic timeline entries need no approval: poll every connection periodically.
        while not self._sync_stop.wait(self.sync_seconds):
            try:
                for room_id, role in self.listening.connected():
                    if self._sync_stop.is_set():
                        break
                    self.listening.sync(self.spotify, room_id, role)
            except Exception:
                pass  # Failures are recorded per connection; the loop keeps running.

    def server_bind(self):
        if self.transport is None:
            return super().server_bind()
        # HTTPServer.server_bind otherwise performs an unnecessary reverse DNS lookup.
        # Retain TCPServer's reuse-address policy for immediate clean restart.
        TCPServer.server_bind(self)
        self.server_name, self.server_port = self.transport.bind, self.server_address[1]

    def process_request(self, request, client_address):
        if self.transport is None:
            return super().process_request(request, client_address)
        self.https_runtime.admit(request, client_address)

    def handle_error(self, request, client_address):
        # Suppress framework tracebacks containing private paths/headers.
        pass

    def server_close(self):
        if self._closed:
            return
        # Cancellation and joining happen before either SQLite or the lifetime
        # lock closes, so a second process cannot clean a still-running worker.
        if self.https_runtime is not None:
            self.https_runtime.stop()
            # A request may hold the shared store/job lock. Apply its bounded
            # join before attempting JobManager.close(), which needs that lock.
            self.https_runtime.join()
        self.jobs.close()
        self._sync_stop.set()
        if self._sync_thread is not None:
            self._sync_thread.join(timeout=30)
        self._closed = True
        try:
            if hasattr(self, 'socket'):
                super().server_close()
            if self.store:
                self.store.close()
            if self.listening:
                self.listening.close()
        finally:
            if self._data_lock is not None:
                fcntl.flock(self._data_lock, fcntl.LOCK_UN)
                os.close(self._data_lock)
                self._data_lock = None
            if self._data_fd is not None:
                os.close(self._data_fd)
                self._data_fd = None


def create_server(data_dir: Path, port: int = 8766, *, dist_dir: Path | None = None, normalize=None,
                  transport: TransportConfig | None = None, spotify: SpotifyClient | None = None,
                  sync_seconds: float = 600) -> DuetServer:
    if normalize is None:
        from .media import normalize_audio
        normalize = normalize_audio
    return DuetServer(data_dir, port, dist_dir, normalize, transport=transport, spotify=spotify,
                      sync_seconds=sync_seconds)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'Duet'

    def setup(self):
        self.owned_connection = self.server.handler_connections.get(self.request)
        self._response_started = False
        if self.owned_connection is None:
            super().setup()
            self.connection.settimeout(5)
        else:
            self.connection = self.request
            self.rfile = HeaderReader(self.owned_connection)
            self.wfile = DeadlineWriter(self.owned_connection)
            self.command = ''
            self.request_version = 'HTTP/1.1'
            self.requestline = ''

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except RequestError as error:
            self.close_connection = True
            try:
                self._json(error.status, {'error': str(error)})
            except OSError:
                pass

    def handle_expect_100(self):
        if self.server.transport is None:
            return super().handle_expect_100()
        self.close_connection = True
        self._json(417, {'error': 'Expect requests are not supported.'})
        return False

    def log_message(self, *args):
        # Paths, headers and bodies may contain private capabilities.
        pass

    def do_GET(self):
        self._handle()

    do_HEAD = do_GET
    do_POST = do_GET
    do_PUT = do_GET
    do_DELETE = do_GET

    def _handle(self):
        self.close_connection = True
        try:
            self._security()
            self._route()
        except DomainError as error:
            if not self._response_started:
                self._json(error.status, {'error': str(error)[:400]})
        except (socket.timeout, TimeoutError):
            if not self._response_started:
                self._json(408, {'error': 'The request timed out. Try again.'})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            if not self._response_started:
                self._json(500, {'error': 'The request could not be completed. Existing room data was preserved.'})

    def _security(self):
        hosts = self.headers.get_all('Host', [])
        origins = self.headers.get_all('Origin', [])
        config = self.server.transport
        if config is None:
            allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
            if (len(hosts) != 1 or hosts[0] not in allowed or len(origins) > 1
                    or (origins and origins[0] != 'http://' + hosts[0])
                    or (self.headers.get('Sec-Fetch-Site') == 'cross-site' and not self._oauth_callback())):
                raise DomainError(403, 'Only requests from this local Duet service are allowed.')
        else:
            sites = self.headers.get_all('Sec-Fetch-Site', [])
            if (len(hosts) != 1 or hosts[0] != config.authority or len(origins) > 1
                    or origins and origins[0] != config.origin
                    or self.command in ('POST', 'PUT', 'DELETE') and len(origins) != 1
                    or len(sites) > 1 or ('cross-site' in sites and not self._oauth_callback())
                    or any(name.lower() == 'forwarded' or name.lower().startswith('x-forwarded-')
                           for name in self.headers)):
                raise DomainError(403, 'Only requests from the configured Duet origin are allowed.')
            if (self.headers.get_all('Expect') or self.headers.get_all('Upgrade')
                    or 'upgrade' in [part.strip() for part in self.headers.get('Connection', '').lower().split(',')]):
                raise DomainError(400, 'Expect and protocol upgrades are not supported.')
            lengths = self.headers.get_all('Content-Length', [])
            if (self.headers.get_all('Transfer-Encoding') or len(lengths) > 1
                    or lengths and not re.fullmatch(r'[0-9]{1,12}', lengths[0])
                    or self.command in ('GET', 'HEAD') and lengths and int(lengths[0]) != 0):
                raise DomainError(400, 'Use valid fixed-length framing without a GET or HEAD body.')
            if (len(self.headers.get_all('Authorization', [])) > 1
                    or self.command in ('POST', 'PUT', 'DELETE')
                    and len(self.headers.get_all('Content-Type', [])) > 1):
                raise DomainError(400, 'Use one authorization and content-type header.')
            if self.command == 'POST' and self.path == '/api/rooms':
                keys = self.headers.get_all('X-Duet-Setup-Key', [])
                if len(keys) != 1 or not matches_setup(config, keys[0]):
                    raise DomainError(403, 'A valid operator setup key is required to create a room.')
        static_room_link = (self.command in ('GET', 'HEAD')
                            and re.fullmatch(r'/\?room=' + ID, self.path))
        if ('?' in self.path and not static_room_link and not self._oauth_callback()) or '#' in self.path:
            raise DomainError(400, 'Query parameters are not accepted by this service.')
        if len(self.path) > 2048:
            raise DomainError(404, 'Route not found.')

    def _oauth_callback(self):
        # Spotify's redirect is a cross-site top-level GET carrying code/state in the query.
        # It is the only such exception; the single-use state authenticates it.
        return self.command == 'GET' and bool(re.fullmatch(r'/spotify/callback\?[A-Za-z0-9_.~%&=-]{1,1500}', self.path))

    def _headers(self, status, content_type, size, headers=None):
        if self.owned_connection is not None and not self._response_started:
            self.owned_connection.phase(transport_limits.RESPONSE_SECONDS)
        self._response_started = True
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(size))
        self.send_header('Connection', 'close')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()

    def _json(self, status, value, headers=None):
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
        self._headers(status, 'application/json; charset=utf-8', len(encoded), headers)
        if self.command != 'HEAD':
            self.wfile.write(encoded)

    def _length(self, limit):
        values = self.headers.get_all('Content-Length', [])
        if self.headers.get_all('Transfer-Encoding') or len(values) != 1 or not re.fullmatch(r'[0-9]{1,12}', values[0]):
            raise DomainError(400, 'Use one valid Content-Length without transfer encoding.')
        size = int(values[0])
        if size > limit:
            raise DomainError(413, 'The request exceeds the allowed size.')
        return size

    def _body(self, size, cancel=None, output=None):
        deadline = time.monotonic() + 30
        if self.owned_connection is not None:
            self.owned_connection.phase(transport_limits.BODY_SECONDS)
            deadline = self.owned_connection.deadline
        result = bytearray()
        while size:
            if cancel is not None and cancel.is_set():
                raise DomainError(409, 'Upload cancelled.')
            if time.monotonic() >= deadline:
                raise DomainError(408, 'Upload timed out.')
            self.connection.settimeout(min(5, max(.01, deadline - time.monotonic())))
            chunk = self.rfile.read1(min(size, 64 * 1024))
            if not chunk:
                raise DomainError(400, 'The request body ended early.')
            size -= len(chunk)
            if output:
                output.write(chunk)
            else:
                result.extend(chunk)
        if self.owned_connection is not None:
            self.owned_connection.check()
        return bytes(result)

    def _object(self, keys):
        size = self._length(MAX_JSON)
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
            raise DomainError(400, 'A JSON object is required.')
        def pairs(items):
            result = {}
            for key, value in items:
                if key in result:
                    raise ValueError('Duplicate key')
                result[key] = value
            return result
        def invalid_constant(value):
            raise ValueError('Non-finite number')
        try:
            result = json.loads(self._body(size).decode('utf-8'), object_pairs_hook=pairs, parse_constant=invalid_constant)
            if type(result) is not dict or set(result) != set(keys.split()):
                raise ValueError('Invalid fields')
            return result
        except (ValueError, UnicodeError, RecursionError):
            raise DomainError(400, 'Supply valid JSON with the required fields only.') from None

    def _token(self, room_id, allow_cookie=False):
        authorization = self.headers.get_all('Authorization', [])
        token = None
        if authorization:
            if len(authorization) == 1 and authorization[0].startswith('Bearer '):
                token = authorization[0][7:]
        elif allow_cookie:
            try:
                if self.server.transport is not None and len(self.headers.get_all('Cookie', [])) > 1:
                    raise DomainError(400, 'Use one media cookie header.')
                cookies = SimpleCookie()
                cookies.load(self.headers.get('Cookie', ''))
                item = cookies.get('duet_' + room_id)
                token = item.value if item else None
            except CookieError:
                pass
        if token is None or not TOKEN.fullmatch(token):
            raise DomainError(401, 'A valid participant Bearer capability is required.')
        role = self.server.store.authenticate(room_id, token)
        return token, role

    def _mix_object(self, keys):
        body = self._object(keys)
        for key, value in body.items():
            if key.endswith('Revision'):
                if type(value) is not int or not 0 <= value <= 2**53 - 1:
                    raise DomainError(400, 'Mix revisions must be nonnegative safe integers.')
            elif key == 'availableOnly':
                if type(value) is not bool:
                    raise DomainError(400, 'Available-only consent must be a boolean.')
            elif key == 'name':
                if (type(value) is not str or not value.strip() or len(value) > 80
                        or '\0' in value):
                    raise DomainError(400, 'Mix name must contain 1–80 valid Unicode characters.')
                try:
                    value.encode('utf-8')
                except UnicodeError:
                    raise DomainError(400, 'Mix name must contain 1–80 valid Unicode characters.') from None
        return body

    def _cookie(self, room_id, token):
        secure = '; Secure' if self.server.transport is not None else ''
        return {'Set-Cookie': f'duet_{room_id}={token}; Path=/api/rooms/{room_id}; HttpOnly; SameSite=Strict{secure}'}

    def _route(self):
        method, path, store = self.command, self.path, self.server.store
        if self._oauth_callback():
            return self._spotify_callback()
        if path == '/api/status' and method in ('GET', 'HEAD'):
            config = self.server.transport
            transport = (dict(mode='https-lan', origin=config.origin, setupRequired=True) if config
                         else dict(mode='http-loopback', origin=f'http://127.0.0.1:{self.server.server_port}', setupRequired=False))
            return self._json(200, dict(version=1, maxRooms=5, maxTracks=12, maxDuration=300,
                                       maxUploadBytes=MAX_UPLOAD, transport=transport))
        if path == '/api/rooms' and method == 'POST':
            body = self._object('title name')
            created = store.create_room(body['title'], body['name'])
            return self._json(201, created, self._cookie(created['roomId'], created['token']))
        match = re.fullmatch(r'/api/rooms/(' + ID + r')(?P<tail>(?:/[A-Za-z0-9/-]+)?)', path)
        if not match:
            if not path.startswith('/api/') and method in ('GET', 'HEAD'):
                return self._static()
            raise DomainError(404, 'Route not found.')
        room_id, tail = match.group(1), match.group('tail')
        if tail == '/join' and method == 'POST':
            body = self._object('inviteToken name')
            joined = store.join_room(room_id, body['inviteToken'], body['name'])
            return self._json(200, joined, self._cookie(room_id, joined['token']))
        audio = re.fullmatch(r'/tracks/(' + ID + r')/audio', tail)
        # Media elements cannot send a Bearer header, so audio and photos accept the room cookie.
        photo_read = re.fullmatch(r'/listening/memories/(' + ID + r')/photo', tail) and method in ('GET', 'HEAD')
        token, role = self._token(room_id, allow_cookie=bool((audio or photo_read) and method in ('GET', 'HEAD')))
        if audio and method in ('GET', 'HEAD'):
            track_id = audio.group(1)
            with self.server.lock:
                room = store.snapshot(room_id, token)
                if not any(track['id'] == track_id for track in room['tracks']):
                    raise DomainError(404, 'Track not found.')
                stream = self._media_open(room_id, track_id)
            return self._file(stream, 'audio/ogg')
        if not tail and method == 'GET':
            with self.server.lock:
                room = store.snapshot(room_id, token)
                room['activeJob'] = self.server.jobs.active(room_id)
            return self._json(200, room)
        if not tail and method == 'DELETE':
            self._object('')
            with self.server.lock:
                if self.server.jobs.active(room_id):
                    raise DomainError(409, 'Cancel this room’s upload before deleting the room.')
                store.delete_room(room_id, token)
                self.server.listening.delete_room(room_id)
                for directory in ('media', 'photos'):
                    try:
                        with _child_directory(self.server._data_fd, directory) as parent:
                            _cleanup_child(parent, room_id)
                    except OSError:
                        pass  # Metadata is authoritative; leftover files cannot be read.
            return self._json(200, {'deleted': True})
        if tail == '/access' and method == 'POST':
            self._object('')
            return self._json(200, store.snapshot(room_id, token), self._cookie(room_id, token))
        if tail == '/invite' and method == 'POST':
            self._object('')
            return self._json(200, store.rotate_invite(room_id, token))
        if tail == '/tracks' and method == 'POST':
            return self._upload(room_id, token, role)
        job_match = re.fullmatch(r'/jobs/(' + ID + r')(/cancel)?', tail)
        if job_match and method == ('POST' if job_match.group(2) else 'GET'):
            if job_match.group(2):
                self._object('')
                job = self.server.jobs.cancel_job(room_id, job_match.group(1), role)
            else:
                job = self.server.jobs.get(room_id, job_match.group(1))
            return self._json(200, {'job': job})
        track_match = re.fullmatch(r'/tracks/(' + ID + r')', tail)
        if track_match and method == 'DELETE':
            self._object('')
            track_id = track_match.group(1)
            with self.server.lock:
                active = self.server.jobs.active(room_id)
                if active and active['trackId'] == track_id:
                    raise DomainError(409, 'Cancel this upload before deleting its track.')
                room = store.delete_track(room_id, token, track_id)
                try:
                    with _child_directory(self.server._data_fd, 'media') as media:
                        with _child_directory(media, room_id) as room_directory:
                            try:
                                os.unlink(track_id + '.ogg', dir_fd=room_directory)
                            except FileNotFoundError:
                                pass
                except OSError:
                    pass
            return self._json(200, room)
        rating = re.fullmatch(r'/ratings/(' + ID + r')', tail)
        if rating and method == 'PUT':
            body = self._object('rating')
            return self._json(200, store.rate(room_id, token, rating.group(1), body['rating']))
        if tail == '/blend' and method == 'POST':
            body = self._object('revision')
            return self._json(200, store.build_playlist(room_id, token, body['revision']))
        if tail == '/playlist' and method == 'PUT':
            body = self._object('trackIds revision')
            return self._json(200, store.set_playlist(room_id, token, body['trackIds'], body['revision']))
        if tail == '/mixes' and method == 'POST':
            body = self._mix_object('name playlistRevision savedMixesRevision')
            return self._json(201, store.save_mix(room_id, token, body['name'],
                                                body['playlistRevision'], body['savedMixesRevision']))
        mix = re.fullmatch(r'/mixes/(' + ID + r')(?P<action>/(?:playlist|name|load))?', tail)
        if mix:
            mix_id, action = mix.group(1), mix.group('action')
            if action == '/playlist' and method == 'PUT':
                body = self._mix_object('playlistRevision savedMixesRevision')
                return self._json(200, store.update_mix(room_id, token, mix_id,
                                                       body['playlistRevision'], body['savedMixesRevision']))
            if action == '/name' and method == 'PUT':
                body = self._mix_object('name savedMixesRevision')
                return self._json(200, store.rename_mix(room_id, token, mix_id, body['name'],
                                                       body['savedMixesRevision']))
            if action is None and method == 'DELETE':
                body = self._mix_object('savedMixesRevision')
                return self._json(200, store.delete_mix(room_id, token, mix_id,
                                                       body['savedMixesRevision']))
            if action == '/load' and method == 'POST':
                body = self._mix_object('savedMixesRevision playlistRevision playbackRevision availableOnly')
                return self._json(200, store.load_mix(room_id, token, mix_id,
                                                     body['savedMixesRevision'], body['playlistRevision'],
                                                     body['playbackRevision'], body['availableOnly']))
        if tail == '/playback' and method == 'PUT':
            body = self._object('trackId playing position revision')
            return self._json(200, store.set_playback(room_id, token, body['trackId'], body['playing'], body['position'], body['revision']))
        if tail == '/memories' and method == 'POST':
            body = self._object('trackId date text')
            return self._json(200, store.add_memory(room_id, token, body['trackId'], body['date'], body['text']))
        memory = re.fullmatch(r'/memories/(' + ID + r')', tail)
        if memory and method == 'PUT':
            body = self._object('date text expectedDate expectedText')
            return self._json(200, store.update_memory(room_id, token, memory.group(1), body['date'],
                                                     body['text'], body['expectedDate'], body['expectedText']))
        if memory and method == 'DELETE':
            self._object('')
            return self._json(200, store.delete_memory(room_id, token, memory.group(1)))
        if tail.startswith('/listening'):
            return self._listening(room_id, role, tail, method)
        if tail == '/export' and method == 'GET':
            exported = store.export_room(room_id, token)
            return self._json(200, exported, {'Content-Disposition': f'attachment; filename="duet-{room_id}.json"'})
        raise DomainError(404, 'Route not found.')

    def _listening_state(self, room_id, include_hidden=False):
        state = self.server.listening.state(room_id, configured=self.server.spotify is not None,
                                            include_hidden=include_hidden)
        state['redirectUri'] = self.server.redirect_uri if self.server.spotify is not None else None
        return state

    def _listening(self, room_id, role, tail, method):
        listening, spotify = self.server.listening, self.server.spotify
        if tail in ('/listening', '/listening/hidden') and method == 'GET':
            return self._json(200, self._listening_state(room_id, tail == '/listening/hidden'))
        if tail == '/listening/connect' and method == 'POST':
            self._object('')
            if spotify is None:
                raise DomainError(409, 'Spotify is not set up on this Duet service. The operator needs to register a Spotify app first.')
            return self._json(200, {'authorizeUrl': listening.begin_auth(spotify, room_id, role, self.server.redirect_uri)})
        if tail == '/listening/sync' and method == 'POST':
            self._object('')
            if spotify is None:
                raise DomainError(409, 'Spotify is not set up on this Duet service.')
            self.server.sync_room(room_id, force=True)
            return self._json(200, self._listening_state(room_id))
        if tail == '/listening/connection' and method == 'DELETE':
            self._object('')
            listening.disconnect(room_id, role)
            return self._json(200, self._listening_state(room_id))
        entry = re.fullmatch(r'/listening/entries/([A-Za-z0-9-]{1,120})', tail)
        if entry and method == 'PUT':
            body = self._object('hidden caption')
            listening.set_override(room_id, role, entry.group(1), body['hidden'], body['caption'])
            return self._json(200, self._listening_state(room_id))
        if tail == '/listening/manual' and method == 'POST':
            body = self._object('date title song note')
            listening.add_manual(room_id, role, body['date'], body['title'], body['song'], body['note'])
            return self._json(201, self._listening_state(room_id))
        if tail == '/listening/memories' and method == 'POST':
            body = self._object('target date text')
            memory_id = listening.add_memory(room_id, role, body['target'], body['date'], body['text'])
            return self._json(201, {'memoryId': memory_id, 'listening': self._listening_state(room_id)})
        memory = re.fullmatch(r'/listening/memories/(' + ID + r')(?P<photo>/photo)?', tail)
        if memory and memory.group('photo'):
            return self._memory_photo(room_id, role, memory.group(1), method)
        if memory and method == 'PUT':
            body = self._object('date text')
            listening.update_memory(room_id, role, memory.group(1), body['date'], body['text'])
            return self._json(200, self._listening_state(room_id))
        if memory and method == 'DELETE':
            self._object('')
            photo = listening.delete_memory(room_id, role, memory.group(1))
            if photo:
                self._remove_photo(room_id, memory.group(1), photo)
            return self._json(200, self._listening_state(room_id))
        manual = re.fullmatch(r'/listening/manual/(' + ID + r')', tail)
        if manual and method == 'PUT':
            body = self._object('date title song note')
            listening.update_manual(room_id, role, manual.group(1), body['date'], body['title'], body['song'], body['note'])
            return self._json(200, self._listening_state(room_id))
        if manual and method == 'DELETE':
            self._object('')
            listening.delete_manual(room_id, role, manual.group(1))
            return self._json(200, self._listening_state(room_id))
        raise DomainError(404, 'Route not found.')

    def _remove_photo(self, room_id, memory_id, mime):
        try:
            with _child_directory(self.server._data_fd, 'photos') as photos:
                with _child_directory(photos, room_id) as room_directory:
                    os.unlink(f'{memory_id}.{EXTENSIONS[mime]}', dir_fd=room_directory)
        except (OSError, KeyError):
            pass  # The database no longer references it, so it cannot be served.

    def _memory_photo(self, room_id, role, memory_id, method):
        listening = self.server.listening
        if method in ('GET', 'HEAD'):
            mime = listening.photo(room_id, memory_id)
            if mime not in EXTENSIONS:
                raise DomainError(404, 'Photo not found.')
            directories = []
            try:
                photos = os.open('photos', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.server._data_fd)
                directories.append(photos)
                room_directory = os.open(room_id, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=photos)
                directories.append(room_directory)
                descriptor = os.open(f'{memory_id}.{EXTENSIONS[mime]}', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=room_directory)
                stream = os.fdopen(descriptor, 'rb')
                if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                    stream.close()
                    raise OSError('Not a regular file')
            except OSError:
                raise DomainError(404, 'Photo not found.') from None
            finally:
                for directory in reversed(directories):
                    os.close(directory)
            return self._file(stream, mime)
        if method == 'DELETE':
            self._object('')
            previous = listening.set_photo(room_id, role, memory_id, None)
            if previous:
                self._remove_photo(room_id, memory_id, previous)
            return self._json(200, self._listening_state(room_id))
        if method != 'PUT':
            raise DomainError(404, 'Route not found.')
        size = self._length(MAX_PHOTO_BYTES)
        declared = self.headers.get('Content-Type', '').split(';')[0].strip().lower()
        data = self._body(size)
        try:
            mime, _, _ = inspect_photo(data)
        except PhotoError as error:
            raise DomainError(400, str(error)) from None
        # The bytes decide the type; a mismatched declaration is refused rather than trusted.
        if declared != mime:
            raise DomainError(400, 'The photo’s contents do not match its declared type.')
        previous = listening.set_photo(room_id, role, memory_id, mime)
        try:
            with _child_directory(self.server._data_fd, 'photos') as photos:
                with _child_directory(photos, room_id, create=True) as room_directory:
                    name = f'{memory_id}.{EXTENSIONS[mime]}'
                    temporary = f'.{memory_id}.{uuid.uuid4().hex}'
                    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600,
                                         dir_fd=room_directory)
                    with os.fdopen(descriptor, 'wb') as output:
                        output.write(data)
                        output.flush()
                        os.fsync(output.fileno())
                    os.replace(temporary, name, src_dir_fd=room_directory, dst_dir_fd=room_directory)
        except OSError:
            listening.set_photo(room_id, role, memory_id, previous)
            raise DomainError(500, 'The photo could not be saved. The memory text was kept.') from None
        if previous and previous != mime:
            self._remove_photo(room_id, memory_id, previous)
        return self._json(200, self._listening_state(room_id))

    def _redirect(self, location):
        self._headers(303, 'text/plain; charset=utf-8', 0, {'Location': location})

    def _plain(self, status, message):
        encoded = message.encode('utf-8')
        self._headers(status, 'text/plain; charset=utf-8', len(encoded))
        self.wfile.write(encoded)

    def _spotify_callback(self):
        listening, spotify = self.server.listening, self.server.spotify
        try:
            params = parse_qs(urlsplit(self.path).query, max_num_fields=6, strict_parsing=True)
        except ValueError:
            params = {}
        if any(len(values) != 1 for values in params.values()):
            params = {}
        pending = listening.take_state(params.get('state', [None])[0]) if spotify is not None else None
        if pending is None:
            return self._plain(400, 'This Spotify connection link expired or was already used. Return to Duet and choose Connect Spotify again.')
        room_id, role = pending['roomId'], pending['role']
        if not self.server.store.has_participant(room_id, role):
            return self._plain(400, 'This Duet room no longer exists.')
        if 'error' in params or 'code' not in params:
            listening.record_failure(room_id, role, 'The Spotify connection was cancelled or refused. Nothing was connected.',
                                     generation=pending['generation'])
            return self._redirect(f'/?room={room_id}')
        try:
            tokens = spotify.exchange(params['code'][0], pending['verifier'], pending['redirectUri'])
            profile = spotify.profile(tokens['accessToken'])
            # Serialize the final admission with room deletion, then verify the authorization
            # generation that survived the network calls. A disconnect wins over a late reply.
            with self.server.lock:
                if not self.server.store.has_participant(room_id, role):
                    return self._plain(400, 'This Duet room no longer exists.')
                if not listening.connect(room_id, role, tokens, profile, generation=pending['generation']):
                    return self._redirect(f'/?room={room_id}')
        except SpotifyError as error:
            listening.record_failure(room_id, role, f'Spotify connection failed: {error}',
                                     generation=pending['generation'])
            return self._redirect(f'/?room={room_id}')
        # Import the history baseline now, so the timeline is ready when the room reopens.
        listening.sync(spotify, room_id, role, force=True)
        return self._redirect(f'/?room={room_id}')

    def _upload(self, room_id, token, role):
        size = self._length(MAX_UPLOAD)
        if size == 0:
            raise DomainError(400, 'Choose a nonempty audio file.')
        try:
            def text_header(name):
                values = self.headers.get_all(name, [])
                if len(values) > 1 or (values and len(values[0]) > 1024):
                    raise ValueError('Invalid metadata header')
                raw = values[0] if values else ''
                if re.search(r'%(?![0-9a-fA-F]{2})', raw):
                    raise ValueError('Invalid percent encoding')
                return unquote(raw, encoding='utf-8', errors='strict')
            title, artist = text_header('X-Track-Title'), text_header('X-Track-Artist')
            if not title.strip() or len(title) > 80 or len(artist) > 80 or '\0' in title + artist:
                raise ValueError('Invalid track metadata')
        except (ValueError, UnicodeError):
            raise DomainError(400, 'Track title must contain 1–80 characters; artist at most 80.') from None
        def interrupt():
            try:
                self.connection.shutdown(socket.SHUT_RD)
            except OSError:
                pass
        with self.server.lock:
            room = self.server.store.snapshot(room_id, token)
            if len(room['tracks']) >= 12:
                raise DomainError(409, 'This room already has twelve tracks. Delete a track first.')
            job = self.server.jobs.reserve(room_id, uuid.uuid4().hex, role, interrupt)
        work_parent = None
        job_directory = None
        def cleanup():
            nonlocal work_parent, job_directory
            try:
                if work_parent is not None and job_directory is not None:
                    _cleanup_child(work_parent, job.id)
            finally:
                if job_directory is not None:
                    os.close(job_directory)
                    job_directory = None
                if work_parent is not None:
                    os.close(work_parent)
                    work_parent = None
        try:
            work_parent = os.open('.jobs', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                  dir_fd=self.server._data_fd)
            os.mkdir(job.id, mode=0o700, dir_fd=work_parent)
            job_directory = os.open(job.id, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=work_parent)
            # Child processes close inherited descriptors. Refer to the parent
            # PID's open directory, so FFmpeg can use the same verified inode.
            work_dir = Path(f'/proc/{os.getpid()}/fd/{job_directory}')
            source, output = work_dir / 'input.audio', work_dir / 'audio.ogg'
            source_fd = os.open('input.audio', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                0o600, dir_fd=job_directory)
            with os.fdopen(source_fd, 'wb') as stream:
                self._body(size, job.cancel, stream)
            def work(cancel, stage):
                duration = self.server.normalize(source, output, cancel, stage)
                info = os.stat('audio.ogg', dir_fd=job_directory, follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_MEDIA:
                    raise RuntimeError('Invalid normalized output')
                def publish():
                    with _child_directory(self.server._data_fd, 'media') as media:
                        with _child_directory(media, room_id, create=True) as room_directory:
                            target = job.track_id + '.ogg'
                            try:
                                os.stat(target, dir_fd=room_directory, follow_symlinks=False)
                            except FileNotFoundError:
                                pass
                            else:
                                raise RuntimeError('Track output already exists')
                            os.replace('audio.ogg', target, src_dir_fd=job_directory, dst_dir_fd=room_directory)
                            try:
                                self.server.store.add_track(room_id, token, job.track_id, title, artist, duration)
                            except BaseException:
                                try:
                                    os.unlink(target, dir_fd=room_directory)
                                except OSError:
                                    pass
                                raise
                return publish
            self.server.jobs.begin(job, work, cleanup)
        except BaseException:
            try:
                cleanup()
            finally:
                self.server.jobs.finish_receiving(job, 'Upload failed. Check the file and try again.')
            raise
        return self._json(202, {'job': self.server.jobs.get(room_id, job.id)})

    @staticmethod
    def _open(path):
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            stream = os.fdopen(descriptor, 'rb')
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                stream.close()
                raise OSError('Not a regular file')
            return stream
        except OSError:
            raise DomainError(404, 'File not found.') from None

    def _media_open(self, room_id, track_id):
        directories = []
        try:
            media = os.open('media', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.server._data_fd)
            directories.append(media)
            room = os.open(room_id, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=media)
            directories.append(room)
            descriptor = os.open(track_id + '.ogg', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=room)
            stream = os.fdopen(descriptor, 'rb')
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                stream.close()
                raise OSError('Not a regular file')
            return stream
        except OSError:
            raise DomainError(404, 'File not found.') from None
        finally:
            for descriptor in reversed(directories):
                os.close(descriptor)

    def _file(self, stream, content_type):
        with stream:
            size = os.fstat(stream.fileno()).st_size
            start, end, status = 0, size - 1, 200
            headers = {'Accept-Ranges': 'bytes'}
            ranges = self.headers.get_all('Range', [])
            if ranges:
                match = re.fullmatch(r'bytes=([0-9]{0,20})-([0-9]{0,20})', ranges[0]) if len(ranges) == 1 else None
                valid = match and (match.group(1) or match.group(2)) and size > 0
                if valid:
                    left, right = match.groups()
                    if left:
                        start = int(left)
                        end = min(int(right), size - 1) if right else size - 1
                        valid = start < size and start <= end
                    else:
                        count = int(right)
                        valid = count > 0
                        start = max(0, size - count)
                if not valid:
                    headers['Content-Range'] = f'bytes */{size}'
                    self._headers(416, content_type, 0, headers)
                    return
                status = 206
                headers['Content-Range'] = f'bytes {start}-{end}/{size}'
            count = max(0, end - start + 1)
            self._headers(status, content_type, count, headers)
            if self.command == 'HEAD':
                return
            stream.seek(start)
            while count:
                chunk = stream.read(min(count, 64 * 1024))
                if not chunk:
                    break
                self.wfile.write(chunk)
                count -= len(chunk)

    def _static(self):
        try:
            path = '/' if re.fullmatch(r'/\?room=' + ID, self.path) else unquote(self.path, errors='strict')
        except UnicodeError:
            raise DomainError(404, 'File not found.') from None
        if path == '/':
            name = 'index.html'
        elif re.fullmatch(r'/assets/[A-Za-z0-9_.-]+\.(?:js|css|svg|png|woff2)', path):
            name = path[1:]
        else:
            raise DomainError(404, 'File not found.')
        target = self.server.dist_dir / name
        if self.server.dist_dir not in target.resolve().parents:
            raise DomainError(404, 'File not found.')
        return self._file(self._open(target), mimetypes.guess_type(name)[0] or 'application/octet-stream')
