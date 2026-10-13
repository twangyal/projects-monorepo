"""A loopback stand-in for Spotify's accounts service and Web API, used only by tests.

It follows the documented shapes Duet relies on: PKCE authorization, token exchange and refresh,
``/me``, ``/me/player/recently-played`` and ``/me/tracks``. Tests control listening per user and
can inject failures.
"""

import base64
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import secrets
import threading
import time
from urllib.parse import parse_qs, urlencode, urlsplit


def iso(milliseconds):
    return datetime.fromtimestamp(milliseconds / 1000, timezone.utc).isoformat().replace('+00:00', 'Z')


def track(track_id, title, artist='Artist'):
    return {'type': 'track', 'id': track_id, 'name': title, 'is_local': False,
            'artists': [{'name': artist}], 'album': {'name': f'{title} album'},
            'external_urls': {'spotify': f'https://open.spotify.com/track/{track_id}'}}


class FakeSpotify:
    def __init__(self, port=0):
        self.users = {}            # user id -> {'name', 'plays': [(ms, track)], 'likes': [(ms, track)]}
        self.next_user = None      # who approves the next authorization
        self.codes = {}            # code -> (user, challenge, redirect_uri)
        self.tokens = {}           # access token -> user
        self.refresh_tokens = {}   # refresh token -> user
        self.failures = []         # queued (path prefix, status, headers) failures
        self.requests = []
        self.rotate_refresh = True
        self.lock = threading.Lock()
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, status, value=None, headers=None):
                body = b'' if value is None else json.dumps(value).encode()
                self.send_response(status)
                for key, item in (headers or {}).items():
                    self.send_header(key, item)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _failure(self, path):
                with fake.lock:
                    for index, (prefix, status, headers) in enumerate(fake.failures):
                        if path.startswith(prefix):
                            del fake.failures[index]
                            return status, headers
                return None

            def do_GET(self):
                parts = urlsplit(self.path)
                query = {key: values[0] for key, values in parse_qs(parts.query).items()}
                fake.requests.append(('GET', parts.path, query))
                if parts.path == '/authorize':
                    return self._authorize(query)
                failure = self._failure(parts.path)
                if failure:
                    return self._send(failure[0], {'error': {'status': failure[0]}}, failure[1])
                user = fake.tokens.get(self.headers.get('Authorization', '')[7:])
                if user is None:
                    return self._send(401, {'error': {'status': 401, 'message': 'The access token expired'}})
                data = fake.users[user]
                if parts.path == '/v1/me':
                    return self._send(200, {'id': user, 'display_name': data['name']})
                if parts.path == '/v1/me/player/recently-played':
                    after = int(query.get('after', 0))
                    plays = sorted((item for item in data['plays'] if item[0] > after), key=lambda item: -item[0])
                    limit = int(query.get('limit', 20))
                    items = [{'track': item[1], 'played_at': iso(item[0]), 'context': None} for item in plays[:limit]]
                    return self._send(200, {'items': items, 'limit': limit, 'next': None, 'cursors': None})
                if parts.path == '/v1/me/tracks':
                    likes = sorted(data['likes'], key=lambda item: -item[0])[:int(query.get('limit', 20))]
                    return self._send(200, {'items': [{'added_at': iso(ms), 'track': item} for ms, item in likes]})
                return self._send(404, {'error': {'status': 404}})

            def _control(self, command):
                # Browser tests drive listening here: users, plays/likes relative to now, next approval.
                now = int(time.time() * 1000)
                for user, name in command.get('users', {}).items():
                    fake.users.setdefault(user, {'name': name, 'plays': [], 'likes': []})
                if 'nextUser' in command:
                    fake.next_user = command['nextUser']
                for item in command.get('plays', []):
                    fake.users[item['user']]['plays'].append((now - item['minutesAgo'] * 60000, track(item['id'], item['title'], item.get('artist', 'Artist'))))
                for item in command.get('likes', []):
                    fake.users[item['user']]['likes'].append((now - item['minutesAgo'] * 60000, track(item['id'], item['title'], item.get('artist', 'Artist'))))
                return self._send(200, {'ok': True})

            def _authorize(self, query):
                assert query['response_type'] == 'code' and query['code_challenge_method'] == 'S256'
                assert set(query['scope'].split()) == {'user-read-recently-played', 'user-library-read'}
                user = fake.next_user
                if user is None:
                    target = f"{query['redirect_uri']}?{urlencode({'error': 'access_denied', 'state': query['state']})}"
                else:
                    code = secrets.token_urlsafe(24)
                    fake.codes[code] = (user, query['code_challenge'], query['redirect_uri'])
                    target = f"{query['redirect_uri']}?{urlencode({'code': code, 'state': query['state']})}"
                self.send_response(303)
                self.send_header('Location', target)
                self.send_header('Content-Length', '0')
                self.end_headers()

            def do_POST(self):
                size = int(self.headers.get('Content-Length', 0))
                raw = self.rfile.read(size).decode()
                if self.path == '/__test/control':
                    return self._control(json.loads(raw))
                form = {key: values[0] for key, values in parse_qs(raw).items()}
                fake.requests.append(('POST', self.path, form))
                failure = self._failure(self.path)
                if failure:
                    return self._send(failure[0], {'error': 'invalid_grant'}, failure[1])
                if self.path != '/api/token' or 'client_secret' in form:
                    return self._send(400, {'error': 'invalid_request'})
                if form.get('grant_type') == 'authorization_code':
                    entry = fake.codes.pop(form.get('code'), None)
                    if entry is None:
                        return self._send(400, {'error': 'invalid_grant'})
                    user, challenge, redirect_uri = entry
                    digest = base64.urlsafe_b64encode(hashlib.sha256(form['code_verifier'].encode()).digest()).rstrip(b'=').decode()
                    if digest != challenge or form.get('redirect_uri') != redirect_uri:
                        return self._send(400, {'error': 'invalid_grant'})
                    return self._send(200, fake._issue(user, refresh=True))
                if form.get('grant_type') == 'refresh_token':
                    user = fake.refresh_tokens.get(form.get('refresh_token'))
                    if user is None:
                        return self._send(400, {'error': 'invalid_grant'})
                    if fake.rotate_refresh:
                        del fake.refresh_tokens[form['refresh_token']]
                    return self._send(200, fake._issue(user, refresh=fake.rotate_refresh))
                return self._send(400, {'error': 'unsupported_grant_type'})

        self.server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def _issue(self, user, refresh):
        access = secrets.token_urlsafe(24)
        self.tokens[access] = user
        value = {'access_token': access, 'token_type': 'Bearer', 'expires_in': 3600,
                 'scope': 'user-read-recently-played user-library-read'}
        if refresh:
            value['refresh_token'] = secrets.token_urlsafe(24)
            self.refresh_tokens[value['refresh_token']] = user
        return value

    @property
    def base(self):
        return f'http://127.0.0.1:{self.server.server_port}'

    def add_user(self, user, name):
        self.users[user] = {'name': name, 'plays': [], 'likes': []}

    def expire_all(self):
        self.tokens.clear()

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()
