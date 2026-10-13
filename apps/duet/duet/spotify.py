"""Minimal Spotify Web API client: Authorization Code with PKCE, the two reads Duet uses, and playlist creation.

Only a public client ID is configured; no client secret exists. Every response is size-limited,
time-limited and validated into small plain records before it reaches storage.
"""

import base64
from datetime import datetime, timezone
import hashlib
import json
import re
import secrets
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

ACCOUNTS_URL = 'https://accounts.spotify.com'
API_URL = 'https://api.spotify.com/v1'
SCOPES = 'user-read-recently-played user-library-read playlist-modify-private'
PLAYLIST_SCOPE = 'playlist-modify-private'
MAX_PLAYLIST_TRACKS = 100
_PLAYLIST_ID = re.compile(r'[A-Za-z0-9]{1,64}\Z')
MAX_RESPONSE = 1024 * 1024
TIMEOUT = 15
_TRACK_ID = re.compile(r'[A-Za-z0-9]{1,64}\Z')
_CLIENT_ID = re.compile(r'[A-Za-z0-9]{8,64}\Z')


class SpotifyError(Exception):
    """A user-safe failure. ``status`` is the Spotify HTTP status when one was received."""

    def __init__(self, message, status=None, retry_after=None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def valid_client_id(value):
    return type(value) is str and bool(_CLIENT_ID.fullmatch(value))


def validate_base_url(value, official):
    """Production uses Spotify's HTTPS hosts; tests may use a loopback HTTP fake."""
    parts = urlsplit(value)
    if value == official:
        return value
    if parts.scheme == 'http' and parts.hostname == '127.0.0.1' and not parts.query and not parts.fragment:
        return value.rstrip('/')
    raise ValueError('Spotify endpoints must be the official HTTPS hosts or a 127.0.0.1 test fake.')


def pkce_pair():
    verifier = secrets.token_urlsafe(64)[:96]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode('ascii')).digest()).rstrip(b'=').decode('ascii')
    return verifier, challenge


def _text(value, limit=200):
    if type(value) is not str:
        return ''
    return value.replace('\0', '')[:limit]


def _track(value):
    """A small validated track record, or None for local files, episodes and malformed items."""
    if type(value) is not dict or value.get('type', 'track') != 'track' or value.get('is_local'):
        return None
    track_id = value.get('id')
    if type(track_id) is not str or not _TRACK_ID.fullmatch(track_id):
        return None
    title = _text(value.get('name')).strip()
    if not title:
        return None
    artists = value.get('artists') if type(value.get('artists')) is list else []
    names = [_text(artist.get('name'), 100).strip() for artist in artists[:5] if type(artist) is dict]
    album = value.get('album') if type(value.get('album')) is dict else {}
    urls = value.get('external_urls') if type(value.get('external_urls')) is dict else {}
    url = urls.get('spotify') if type(urls.get('spotify')) is str else ''
    if not re.fullmatch(r'https://open\.spotify\.com/track/[A-Za-z0-9]+', url or ''):
        url = f'https://open.spotify.com/track/{track_id}'
    return {'id': track_id, 'title': title, 'artists': ', '.join(name for name in names if name)[:300],
            'album': _text(album.get('name')).strip(), 'url': url}


def _timestamp(value):
    """Spotify ISO-8601 UTC timestamps to integer milliseconds."""
    if type(value) is not str or len(value) > 40:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    milliseconds = int(parsed.timestamp() * 1000)
    return milliseconds if 0 < milliseconds < 10**14 else None


class SpotifyClient:
    def __init__(self, client_id, *, accounts_url=ACCOUNTS_URL, api_url=API_URL, timeout=TIMEOUT):
        if not valid_client_id(client_id):
            raise ValueError('The Spotify client ID must contain 8–64 letters or digits.')
        self.client_id = client_id
        self.accounts_url = validate_base_url(accounts_url, ACCOUNTS_URL)
        self.api_url = validate_base_url(api_url, API_URL)
        self.timeout = timeout
        self.opener = build_opener(_NoRedirect)

    def authorize_url(self, state, challenge, redirect_uri):
        query = urlencode({'client_id': self.client_id, 'response_type': 'code', 'redirect_uri': redirect_uri,
                           'code_challenge_method': 'S256', 'code_challenge': challenge, 'state': state,
                           'scope': SCOPES})
        return f'{self.accounts_url}/authorize?{query}'

    def _request(self, request):
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                body = response.read(MAX_RESPONSE + 1)
        except HTTPError as error:
            retry = error.headers.get('Retry-After') if error.headers else None
            retry_after = int(retry) if retry and retry.isdigit() else None
            messages = {400: 'Spotify rejected the request.', 401: 'Spotify access expired or was revoked.',
                        403: 'Spotify refused access for this account or app.', 429: 'Spotify asked Duet to slow down.'}
            raise SpotifyError(messages.get(error.code, f'Spotify returned an error ({error.code}).'),
                               error.code, retry_after) from None
        except (URLError, TimeoutError, OSError):
            raise SpotifyError('Spotify could not be reached. Duet will try again later.') from None
        if len(body) > MAX_RESPONSE:
            raise SpotifyError('Spotify sent an unexpectedly large response.')
        try:
            value = json.loads(body.decode('utf-8'))
        except (ValueError, UnicodeError):
            raise SpotifyError('Spotify sent an unreadable response.') from None
        if type(value) is not dict:
            raise SpotifyError('Spotify sent an unexpected response.')
        return value

    def _token(self, fields):
        request = Request(f'{self.accounts_url}/api/token', data=urlencode({**fields, 'client_id': self.client_id}).encode('ascii'),
                          headers={'Content-Type': 'application/x-www-form-urlencoded'}, method='POST')
        value = self._request(request)
        access, expires = value.get('access_token'), value.get('expires_in')
        if type(access) is not str or not 0 < len(access) <= 2048 or type(expires) is not int or not 0 < expires <= 86400:
            raise SpotifyError('Spotify sent an invalid token response.')
        refresh = value.get('refresh_token')
        if refresh is not None and (type(refresh) is not str or not 0 < len(refresh) <= 2048):
            raise SpotifyError('Spotify sent an invalid token response.')
        scope = value.get('scope')
        # The granted scopes decide what Duet may offer; an absent field means unknown.
        scope = scope if type(scope) is str and len(scope) <= 1000 else None
        return {'accessToken': access, 'expiresIn': expires, 'refreshToken': refresh, 'scope': scope}

    def exchange(self, code, verifier, redirect_uri):
        if type(code) is not str or not 0 < len(code) <= 2048:
            raise SpotifyError('Spotify returned an invalid authorization code.')
        return self._token({'grant_type': 'authorization_code', 'code': code, 'redirect_uri': redirect_uri,
                            'code_verifier': verifier})

    def refresh(self, refresh_token):
        # PKCE refresh tokens may rotate: the caller keeps the old one when none is returned.
        return self._token({'grant_type': 'refresh_token', 'refresh_token': refresh_token})

    def _get(self, path, access_token):
        return self._request(Request(f'{self.api_url}{path}', headers={'Authorization': f'Bearer {access_token}'}))

    def _post(self, path, access_token, body):
        data = json.dumps(body).encode('utf-8')
        return self._request(Request(f'{self.api_url}{path}', data=data, method='POST',
                                     headers={'Authorization': f'Bearer {access_token}', 'Content-Type': 'application/json'}))

    def create_playlist(self, access_token, name, description):
        """A private playlist in the signed-in person's account (``POST /me/playlists``)."""
        value = self._post('/me/playlists', access_token, {'name': name, 'public': False, 'description': description})
        playlist_id = value.get('id')
        url = (value.get('external_urls') or {}).get('spotify') if type(value.get('external_urls')) is dict else None
        if type(playlist_id) is not str or not _PLAYLIST_ID.fullmatch(playlist_id):
            raise SpotifyError('Spotify sent an invalid playlist.')
        if type(url) is not str or not re.fullmatch(r'https://open\.spotify\.com/playlist/[A-Za-z0-9]{1,64}', url):
            url = f'https://open.spotify.com/playlist/{playlist_id}'
        return {'id': playlist_id, 'url': url}

    def add_items(self, access_token, playlist_id, track_ids):
        """Add up to 100 tracks in order (``POST /playlists/{id}/items``)."""
        if not _PLAYLIST_ID.fullmatch(playlist_id) or not 0 < len(track_ids) <= MAX_PLAYLIST_TRACKS or \
                not all(_TRACK_ID.fullmatch(track) for track in track_ids):
            raise SpotifyError('Duet tried to add an invalid track list.')
        value = self._post(f'/playlists/{playlist_id}/items', access_token, {'uris': [f'spotify:track:{track}' for track in track_ids]})
        if type(value.get('snapshot_id')) is not str:
            raise SpotifyError('Spotify sent an invalid playlist update.')

    def profile(self, access_token):
        value = self._get('/me', access_token)
        user = value.get('id')
        if type(user) is not str or not 0 < len(user) <= 128:
            raise SpotifyError('Spotify sent an invalid profile.')
        return {'id': user, 'name': _text(value.get('display_name') or user, 100)}

    def recently_played(self, access_token, after=None):
        query = {'limit': 50}
        if after is not None:
            query['after'] = int(after)
        value = self._get(f'/me/player/recently-played?{urlencode(query)}', access_token)
        items = value.get('items')
        if type(items) is not list or len(items) > 50:
            raise SpotifyError('Spotify sent invalid listening history.')
        plays = []
        for item in items:
            if type(item) is not dict:
                continue
            track, played_at = _track(item.get('track')), _timestamp(item.get('played_at'))
            if track and played_at:
                plays.append({**track, 'playedAt': played_at})
        return plays

    def saved_tracks(self, access_token):
        value = self._get('/me/tracks?limit=50', access_token)
        items = value.get('items')
        if type(items) is not list or len(items) > 50:
            raise SpotifyError('Spotify sent an invalid Liked Songs list.')
        likes = []
        for item in items:
            if type(item) is not dict:
                continue
            track, added_at = _track(item.get('track')), _timestamp(item.get('added_at'))
            if track and added_at:
                likes.append({**track, 'addedAt': added_at})
        return likes
