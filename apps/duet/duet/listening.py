"""Spotify listening connections and the automatically maintained shared timeline.

Credentials and imported listening live in their own ``listening.sqlite3`` (mode 0600), never in
the room document, exports or library backups. Disconnecting deletes a person's credential and
imported listening; deleting a room deletes everything for it.

Timeline definitions (shown to users):
- **both**: a song each person has played, as seen in their Spotify history. It never claims they
  listened together; it reports each person's own times and whether plays were within 30 minutes.
- **new**: the first time Duet saw someone play a song after they connected. History imported at
  connection is a baseline, so older listening is never labeled new.
- **favorite**: a song someone added to Liked Songs after connecting.
- **manual**: an entry a person wrote.
"""

from contextlib import contextmanager
from datetime import date as calendar_date
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
import uuid

from .spotify import MAX_PLAYLIST_TRACKS, PLAYLIST_SCOPE, SpotifyError, pkce_pair
from .store import DomainError

ROLES = ('host', 'guest')
STATE_SECONDS = 600
NEAR_MS = 30 * 60 * 1000
MAX_PLAYS_PER_ROLE = 2000
MAX_TIMELINE = 300
MAX_MANUAL = 200
_ID = re.compile(r'[0-9a-f]{32}\Z')
_TRACK = re.compile(r'[A-Za-z0-9]{1,64}\Z')
ENTRY_KEY = re.compile(r'(?:both-[A-Za-z0-9]{1,64}|(?:new|favorite)-(?:host|guest)-[A-Za-z0-9]{1,64}|manual-[0-9a-f]{32})\Z')

SCHEMA = '''
CREATE TABLE IF NOT EXISTS connections (
  room_id TEXT NOT NULL, role TEXT NOT NULL, refresh_token TEXT NOT NULL, access_token TEXT,
  expires_at REAL NOT NULL DEFAULT 0, spotify_user TEXT NOT NULL, display_name TEXT NOT NULL,
  connected_at REAL NOT NULL, cursor_ms INTEGER, synced_at REAL, sync_error TEXT, retry_at REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, role));
CREATE TABLE IF NOT EXISTS pending (
  state TEXT PRIMARY KEY, room_id TEXT NOT NULL, role TEXT NOT NULL, verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS auth_failures (
  room_id TEXT NOT NULL, role TEXT NOT NULL, message TEXT NOT NULL, at REAL NOT NULL, PRIMARY KEY (room_id, role));
CREATE TABLE IF NOT EXISTS tracks (
  room_id TEXT NOT NULL, track_id TEXT NOT NULL, title TEXT NOT NULL, artists TEXT NOT NULL,
  album TEXT NOT NULL, url TEXT NOT NULL, PRIMARY KEY (room_id, track_id));
CREATE TABLE IF NOT EXISTS seen (
  room_id TEXT NOT NULL, role TEXT NOT NULL, track_id TEXT NOT NULL, first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL, plays INTEGER NOT NULL, baseline INTEGER NOT NULL,
  PRIMARY KEY (room_id, role, track_id));
CREATE TABLE IF NOT EXISTS plays (
  room_id TEXT NOT NULL, role TEXT NOT NULL, track_id TEXT NOT NULL, played_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, role, track_id, played_at));
CREATE TABLE IF NOT EXISTS likes (
  room_id TEXT NOT NULL, role TEXT NOT NULL, track_id TEXT NOT NULL, added_at INTEGER NOT NULL,
  baseline INTEGER NOT NULL, PRIMARY KEY (room_id, role, track_id));
CREATE TABLE IF NOT EXISTS overrides (
  room_id TEXT NOT NULL, entry_key TEXT NOT NULL, hidden INTEGER NOT NULL, caption TEXT NOT NULL,
  updated_by TEXT NOT NULL, updated_at REAL NOT NULL, PRIMARY KEY (room_id, entry_key));
CREATE TABLE IF NOT EXISTS manual (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL, author TEXT NOT NULL, date TEXT NOT NULL,
  title TEXT NOT NULL, song TEXT NOT NULL, note TEXT NOT NULL, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS song_memories (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL, target TEXT NOT NULL, label TEXT NOT NULL, author TEXT NOT NULL,
  date TEXT NOT NULL, text TEXT NOT NULL, photo TEXT, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS grants (
  room_id TEXT NOT NULL, role TEXT NOT NULL, scope TEXT, PRIMARY KEY (room_id, role));
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT NOT NULL, room_id TEXT NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,
  tracks INTEGER NOT NULL, created_at REAL NOT NULL, PRIMARY KEY (room_id, id));
'''
ROOM_TABLES = ('connections', 'pending', 'auth_failures', 'tracks', 'seen', 'plays', 'likes', 'overrides', 'manual',
               'song_memories', 'grants', 'playlists')
PLAYLIST_KINDS = ('both', 'new', 'favorite')
MAX_PLAYLISTS = 50
MAX_MEMORIES = 300
MEMORY_TARGET = re.compile(r'(?:track-[A-Za-z0-9]{1,64}|manual-[0-9a-f]{32})\Z')
PHOTO_TYPES = ('image/jpeg', 'image/png', 'image/webp', 'image/gif')


def _text(value, limit, label, *, empty=False):
    if (type(value) is not str or len(value) > limit or '\0' in value
            or (not empty and not value.strip())):
        raise DomainError(400, f'{label} must contain {"0" if empty else "1"}–{limit} characters without NUL bytes.')
    try:
        value.encode('utf-8')
    except UnicodeError:
        raise DomainError(400, f'{label} must contain valid Unicode text.') from None
    return value


def _date(value):
    if type(value) is not str or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        raise DomainError(400, 'Entry date must use YYYY-MM-DD.')
    try:
        parsed = calendar_date.fromisoformat(value)
    except ValueError:
        raise DomainError(400, 'Entry date must be a valid calendar date.') from None
    if not 1900 <= parsed.year <= 2100:
        raise DomainError(400, 'Entry date must be from 1900 through 2100.')
    return value


def derive_timeline(*, tracks, seen, plays, likes, overrides, manual):
    """Pure derivation of timeline entries, newest first.

    ``seen`` maps (role, track) to aggregates; ``plays`` maps (role, track) to recent play times.
    """
    entries = []

    def track_of(track_id):
        return dict(tracks.get(track_id) or {'id': track_id, 'title': 'Unknown song', 'artists': '', 'album': '',
                                             'url': f'https://open.spotify.com/track/{track_id}'})

    by_track = {}
    for (role, track_id), row in seen.items():
        by_track.setdefault(track_id, {})[role] = row
    for track_id, rows in by_track.items():
        if set(rows) == set(ROLES):
            nearest = None
            for host_time in plays.get(('host', track_id), []):
                for guest_time in plays.get(('guest', track_id), []):
                    gap = abs(host_time - guest_time)
                    nearest = gap if nearest is None else min(nearest, gap)
            entries.append({
                'key': f'both-{track_id}', 'kind': 'both', 'track': track_of(track_id),
                'at': max(rows['host']['firstAt'], rows['guest']['firstAt']),
                'people': {role: {'firstAt': rows[role]['firstAt'], 'lastAt': rows[role]['lastAt'],
                                  'plays': rows[role]['plays']} for role in ROLES},
                'withinThirtyMinutes': nearest is not None and nearest <= NEAR_MS,
            })
        for role, row in rows.items():
            liked_before = likes.get((role, track_id), {}).get('baseline', False)
            if not row['baseline'] and not liked_before:
                entries.append({'key': f'new-{role}-{track_id}', 'kind': 'new', 'track': track_of(track_id),
                                'at': row['firstAt'], 'role': role, 'plays': row['plays']})
    for (role, track_id), like in likes.items():
        if not like['baseline']:
            entries.append({'key': f'favorite-{role}-{track_id}', 'kind': 'favorite', 'track': track_of(track_id),
                            'at': like['addedAt'], 'role': role})
    for item in manual:
        entries.append({'key': f'manual-{item["id"]}', 'kind': 'manual', 'id': item['id'], 'role': item['author'],
                        'date': item['date'], 'title': item['title'], 'song': item['song'], 'note': item['note'],
                        'at': item['createdAt']})
    for entry in entries:
        override = overrides.get(entry['key'])
        entry['hidden'] = bool(override and override['hidden'])
        entry['caption'] = override['caption'] if override else ''
    # Manual entries sort by their chosen date; automatic ones by observation time.
    def order(entry):
        if entry['kind'] == 'manual':
            return (entry['date'], entry['at'])
        return (time.strftime('%Y-%m-%d', time.gmtime(entry['at'] / 1000)), entry['at'])
    entries.sort(key=order, reverse=True)
    return entries


class ListeningStore:
    def __init__(self, data_dir: Path, now=time.time):
        self.now = now
        self.lock = threading.RLock()
        path = Path(data_dir) / 'listening.sqlite3'
        # Credentials: create the database owner-only before SQLite opens it.
        descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        os.close(descriptor)
        os.chmod(path, 0o600, follow_symlinks=False)
        self.database = sqlite3.connect(path, timeout=10, isolation_level=None, check_same_thread=False)
        self.database.execute('PRAGMA journal_mode=WAL')
        self.database.execute('PRAGMA synchronous=FULL')
        self.database.executescript(SCHEMA)
        self.closed = False

    def close(self):
        with self.lock:
            if not self.closed:
                self.database.close()
                self.closed = True

    @contextmanager
    def _transaction(self):
        with self.lock:
            try:
                self.database.execute('BEGIN IMMEDIATE')
            except sqlite3.Error:
                raise DomainError(500, 'Listening storage is unavailable. Try again.') from None
            try:
                yield self.database
                self.database.execute('COMMIT')
            except BaseException as error:
                try:
                    self.database.execute('ROLLBACK')
                except sqlite3.Error:
                    pass
                if isinstance(error, sqlite3.Error):
                    raise DomainError(500, 'Listening data could not be saved or read.') from None
                raise

    # Authorization ------------------------------------------------------------------------

    def begin_auth(self, client, room_id, role, redirect_uri):
        state = secrets.token_urlsafe(32)
        verifier, challenge = pkce_pair()
        now = self.now()
        with self._transaction() as db:
            db.execute('DELETE FROM pending WHERE created_at < ?', (now - STATE_SECONDS,))
            db.execute('DELETE FROM pending WHERE room_id=? AND role=?', (room_id, role))
            db.execute('INSERT INTO pending VALUES (?,?,?,?,?,?)', (state, room_id, role, verifier, redirect_uri, now))
        return client.authorize_url(state, challenge, redirect_uri)

    def take_state(self, state):
        """Single use: the pending authorization is removed whether or not it is still valid."""
        if type(state) is not str or not re.fullmatch(r'[A-Za-z0-9_-]{20,100}', state):
            return None
        with self._transaction() as db:
            row = db.execute('SELECT room_id, role, verifier, redirect_uri, created_at FROM pending WHERE state=?',
                             (state,)).fetchone()
            db.execute('DELETE FROM pending WHERE state=?', (state,))
        if row is None or self.now() - row[4] > STATE_SECONDS:
            return None
        return {'roomId': row[0], 'role': row[1], 'verifier': row[2], 'redirectUri': row[3]}

    def record_failure(self, room_id, role, message):
        with self._transaction() as db:
            db.execute('INSERT OR REPLACE INTO auth_failures VALUES (?,?,?,?)', (room_id, role, message[:300], self.now()))

    def connect(self, room_id, role, tokens, profile):
        now = self.now()
        if not tokens.get('refreshToken'):
            raise SpotifyError('Spotify did not provide lasting access. Try connecting again.')
        with self._transaction() as db:
            db.execute('DELETE FROM auth_failures WHERE room_id=? AND role=?', (room_id, role))
            db.execute('INSERT OR REPLACE INTO grants VALUES (?,?,?)', (room_id, role, tokens.get('scope')))
            existing = db.execute('SELECT spotify_user FROM connections WHERE room_id=? AND role=?', (room_id, role)).fetchone()
            if existing and existing[0] == profile['id']:
                # Re-authorizing the same account (for example to grant a new permission) keeps their listening.
                db.execute('UPDATE connections SET refresh_token=?, access_token=?, expires_at=?, display_name=?, sync_error=NULL, '
                           'retry_at=0 WHERE room_id=? AND role=?',
                           (tokens['refreshToken'], tokens['accessToken'], now + tokens['expiresIn'] - 30, profile['name'], room_id, role))
                return
            # Connecting a different account starts a fresh baseline for this person.
            for table in ('seen', 'plays', 'likes'):
                db.execute(f'DELETE FROM {table} WHERE room_id=? AND role=?', (room_id, role))
            db.execute('INSERT OR REPLACE INTO connections (room_id, role, refresh_token, access_token, expires_at, '
                       'spotify_user, display_name, connected_at, cursor_ms, synced_at, sync_error, retry_at) '
                       'VALUES (?,?,?,?,?,?,?,?,NULL,NULL,NULL,0)',
                       (room_id, role, tokens['refreshToken'], tokens['accessToken'], now + tokens['expiresIn'] - 30,
                        profile['id'], profile['name'], now))

    def disconnect(self, room_id, role):
        with self._transaction() as db:
            for table in ('connections', 'seen', 'plays', 'likes', 'auth_failures', 'pending', 'grants'):
                db.execute(f'DELETE FROM {table} WHERE room_id=? AND role=?', (room_id, role))
            # Song metadata no longer referenced by anyone's listening is removed too.
            db.execute('DELETE FROM tracks WHERE room_id=? AND track_id NOT IN '
                       '(SELECT track_id FROM seen WHERE room_id=? UNION SELECT track_id FROM likes WHERE room_id=?)',
                       (room_id, room_id, room_id))

    def delete_room(self, room_id):
        with self._transaction() as db:
            for table in ROOM_TABLES:
                db.execute(f'DELETE FROM {table} WHERE room_id=?', (room_id,))

    # Synchronization -----------------------------------------------------------------------

    def connected(self):
        with self._transaction() as db:
            return db.execute('SELECT room_id, role FROM connections').fetchall()

    def _credentials(self, room_id, role):
        with self._transaction() as db:
            return db.execute('SELECT refresh_token, access_token, expires_at, cursor_ms, connected_at, synced_at, retry_at '
                              'FROM connections WHERE room_id=? AND role=?', (room_id, role)).fetchone()

    def sync(self, client, room_id, role, *, force=False):
        """Fetch new plays and likes. Network calls happen outside storage transactions."""
        row = self._credentials(room_id, role)
        if row is None:
            return False
        refresh_token, access_token, expires_at, cursor, connected_at, synced_at, retry_at = row
        now = self.now()
        if now < retry_at and not force:
            return False
        try:
            access_token = self._fresh_access(client, room_id, role, refresh_token, access_token, expires_at)
            plays = client.recently_played(access_token, cursor)
            likes = client.saved_tracks(access_token)
        except SpotifyError as error:
            delay = error.retry_after if error.status == 429 and error.retry_after else (60 if error.status == 429 else 0)
            message = 'Spotify access was revoked or expired. Disconnect and connect again.' if error.status in (400, 401) else str(error)
            with self._transaction() as db:
                db.execute('UPDATE connections SET sync_error=?, retry_at=? WHERE room_id=? AND role=?',
                           (message, now + min(delay, 3600), room_id, role))
            return False
        baseline = synced_at is None
        with self._transaction() as db:
            if db.execute('SELECT 1 FROM connections WHERE room_id=? AND role=?', (room_id, role)).fetchone() is None:
                return False  # Disconnected while fetching: discard the results.
            newest = cursor or 0
            for play in sorted(plays, key=lambda item: item['playedAt']):
                if not _TRACK.fullmatch(play['id']):
                    continue
                newest = max(newest, play['playedAt'])
                self._track(db, room_id, play)
                inserted = db.execute('INSERT OR IGNORE INTO plays VALUES (?,?,?,?)',
                                      (room_id, role, play['id'], play['playedAt'])).rowcount
                if not inserted:
                    continue
                existing = db.execute('SELECT first_at, last_at FROM seen WHERE room_id=? AND role=? AND track_id=?',
                                      (room_id, role, play['id'])).fetchone()
                if existing is None:
                    db.execute('INSERT INTO seen VALUES (?,?,?,?,?,?,?)',
                               (room_id, role, play['id'], play['playedAt'], play['playedAt'], 1, int(baseline)))
                else:
                    db.execute('UPDATE seen SET first_at=min(first_at, ?), last_at=max(last_at, ?), plays=plays+1 '
                               'WHERE room_id=? AND role=? AND track_id=?',
                               (play['playedAt'], play['playedAt'], room_id, role, play['id']))
            connected_ms = int(connected_at * 1000)
            for like in likes:
                if not _TRACK.fullmatch(like['id']):
                    continue
                self._track(db, room_id, like)
                # Only songs liked after connecting become timeline favorites.
                db.execute('INSERT OR IGNORE INTO likes VALUES (?,?,?,?,?)',
                           (room_id, role, like['id'], like['addedAt'], int(baseline or like['addedAt'] < connected_ms)))
            db.execute('DELETE FROM plays WHERE room_id=? AND role=? AND played_at NOT IN '
                       '(SELECT played_at FROM plays WHERE room_id=? AND role=? ORDER BY played_at DESC LIMIT ?)',
                       (room_id, role, room_id, role, MAX_PLAYS_PER_ROLE))
            db.execute('UPDATE connections SET cursor_ms=?, synced_at=?, sync_error=NULL, retry_at=0 WHERE room_id=? AND role=?',
                       (newest or None, now, room_id, role))
        return True

    def _fresh_access(self, client, room_id, role, refresh_token, access_token, expires_at):
        """A valid access token, refreshing (and keeping any rotated refresh token) when needed."""
        now = self.now()
        if access_token and now < expires_at:
            return access_token
        tokens = client.refresh(refresh_token)
        with self._transaction() as db:
            db.execute('UPDATE connections SET access_token=?, expires_at=?, refresh_token=? WHERE room_id=? AND role=?',
                       (tokens['accessToken'], now + tokens['expiresIn'] - 30, tokens['refreshToken'] or refresh_token,
                        room_id, role))
            if tokens.get('scope'):
                db.execute('UPDATE grants SET scope=? WHERE room_id=? AND role=?', (tokens['scope'], room_id, role))
        return tokens['accessToken']

    # Occasion playlists ------------------------------------------------------------------------

    @staticmethod
    def validate_selection(value):
        """Which timeline songs go into a playlist: entry kinds, optional date range, memories only."""
        if type(value) is not dict or set(value) != {'kinds', 'from', 'to', 'memoriesOnly'}:
            raise DomainError(400, 'Choose which timeline songs to include.')
        kinds = value['kinds']
        if type(kinds) is not list or not kinds or len(set(kinds)) != len(kinds) or any(kind not in PLAYLIST_KINDS for kind in kinds):
            raise DomainError(400, 'Choose at least one of: songs you both played, first-time songs, new favorites.')
        start = None if value['from'] in (None, '') else _date(value['from'])
        end = None if value['to'] in (None, '') else _date(value['to'])
        if start and end and start > end:
            raise DomainError(400, 'The playlist start date must be on or before its end date.')
        if type(value['memoriesOnly']) is not bool:
            raise DomainError(400, 'Choose whether to include only songs with memories.')
        return {'kinds': kinds, 'from': start, 'to': end, 'memoriesOnly': value['memoriesOnly']}

    @staticmethod
    def select_tracks(entries, selection):
        """Visible timeline songs matching the selection, oldest first, each song once."""
        chosen, seen = [], set()
        for entry in sorted(entries, key=lambda item: item['at']):
            if entry['hidden'] or entry['kind'] not in selection['kinds']:
                continue
            day = time.strftime('%Y-%m-%d', time.gmtime(entry['at'] / 1000))
            if (selection['from'] and day < selection['from']) or (selection['to'] and day > selection['to']):
                continue
            if selection['memoriesOnly'] and not entry['memories']:
                continue
            track = entry['track']
            if track['id'] in seen:
                continue
            seen.add(track['id'])
            chosen.append({'id': track['id'], 'title': track['title'], 'artists': track['artists']})
        return chosen

    def playlist_preview(self, room_id, selection):
        state = self.state(room_id, configured=True)
        return self.select_tracks(state['entries'], self.validate_selection(selection))

    def create_playlist(self, client, room_id, role, name, selection):
        name = _text(name, 100, 'Playlist name')
        selection = self.validate_selection(selection)
        row = self._credentials(room_id, role)
        if row is None:
            raise DomainError(409, 'Connect your Spotify before creating a playlist in it.')
        with self._transaction() as db:
            grant = db.execute('SELECT scope FROM grants WHERE room_id=? AND role=?', (room_id, role)).fetchone()
            count = db.execute('SELECT count(*) FROM playlists WHERE room_id=?', (room_id,)).fetchone()[0]
        if grant is None or grant[0] is None or PLAYLIST_SCOPE not in grant[0].split():
            raise DomainError(409, 'Reconnect your Spotify to allow Duet to create private playlists (a new permission).')
        if count >= MAX_PLAYLISTS:
            raise DomainError(409, f'This room has already created {MAX_PLAYLISTS} playlists.')
        tracks = self.select_tracks(self.state(room_id, configured=True)['entries'], selection)
        if not tracks:
            raise DomainError(409, 'No timeline songs match these choices yet.')
        if len(tracks) > MAX_PLAYLIST_TRACKS:
            raise DomainError(409, f'A Duet playlist holds at most {MAX_PLAYLIST_TRACKS} songs. Narrow the dates or kinds.')
        refresh_token, access_token, expires_at = row[0], row[1], row[2]
        try:
            access = self._fresh_access(client, room_id, role, refresh_token, access_token, expires_at)
            playlist = client.create_playlist(access, name, 'Made with Duet from our shared listening timeline.')
        except SpotifyError as error:
            if error.status == 403:
                raise DomainError(409, 'Spotify refused to create the playlist. Reconnect your Spotify to grant playlist access.') from None
            raise DomainError(502, str(error)) from None
        try:
            client.add_items(access, playlist['id'], [track['id'] for track in tracks])
        except SpotifyError as error:
            # The empty playlist already exists in their account; say so rather than leave it unexplained.
            raise DomainError(502, f'Spotify created the playlist “{name}” but did not add its songs ({error}) '
                                   'You can delete the empty playlist in Spotify and try again.') from None
        record = {'id': playlist['id'], 'role': role, 'name': name, 'url': playlist['url'], 'tracks': len(tracks),
                  'createdAt': self.now() * 1000}
        with self._transaction() as db:
            db.execute('INSERT OR REPLACE INTO playlists VALUES (?,?,?,?,?,?,?)',
                       (playlist['id'], room_id, role, name, playlist['url'], len(tracks), self.now()))
        return record

    @staticmethod
    def _track(db, room_id, track):
        db.execute('INSERT OR REPLACE INTO tracks VALUES (?,?,?,?,?,?)',
                   (room_id, track['id'], track['title'][:200], track['artists'][:300], track['album'][:200], track['url'][:200]))

    # Curation ---------------------------------------------------------------------------------

    def set_override(self, room_id, role, key, hidden, caption):
        if type(key) is not str or not ENTRY_KEY.fullmatch(key):
            raise DomainError(404, 'Timeline entry not found.')
        if type(hidden) is not bool:
            raise DomainError(400, 'Hidden must be true or false.')
        caption = _text(caption, 200, 'Caption', empty=True)
        with self._transaction() as db:
            db.execute('INSERT OR REPLACE INTO overrides VALUES (?,?,?,?,?,?)',
                       (room_id, key, int(hidden), caption, role, self.now()))

    def add_manual(self, room_id, role, date, title, song, note):
        date, title = _date(date), _text(title, 120, 'Entry title')
        song, note = _text(song, 120, 'Song', empty=True), _text(note, 1000, 'Note', empty=True)
        with self._transaction() as db:
            if db.execute('SELECT count(*) FROM manual WHERE room_id=?', (room_id,)).fetchone()[0] >= MAX_MANUAL:
                raise DomainError(409, 'This timeline already has 200 written entries. Delete one before adding another.')
            entry_id = uuid.uuid4().hex
            db.execute('INSERT INTO manual VALUES (?,?,?,?,?,?,?,?)',
                       (entry_id, room_id, role, date, title, song, note, self.now() * 1000))
        return entry_id

    def update_manual(self, room_id, role, entry_id, date, title, song, note):
        date, title = _date(date), _text(title, 120, 'Entry title')
        song, note = _text(song, 120, 'Song', empty=True), _text(note, 1000, 'Note', empty=True)
        with self._transaction() as db:
            author = self._manual_author(db, room_id, entry_id)
            if author != role:
                raise DomainError(403, 'Only the person who wrote this entry can edit it.')
            db.execute('UPDATE manual SET date=?, title=?, song=?, note=? WHERE id=?', (date, title, song, note, entry_id))

    def delete_manual(self, room_id, role, entry_id):
        with self._transaction() as db:
            if self._manual_author(db, room_id, entry_id) != role:
                raise DomainError(403, 'Only the person who wrote this entry can delete it.')
            db.execute('DELETE FROM manual WHERE id=?', (entry_id,))
            db.execute('DELETE FROM overrides WHERE room_id=? AND entry_key=?', (room_id, f'manual-{entry_id}'))

    @staticmethod
    def _manual_author(db, room_id, entry_id):
        if type(entry_id) is not str or not _ID.fullmatch(entry_id):
            raise DomainError(404, 'Timeline entry not found.')
        row = db.execute('SELECT author FROM manual WHERE id=? AND room_id=?', (entry_id, room_id)).fetchone()
        if row is None:
            raise DomainError(404, 'Timeline entry not found.')
        return row[0]

    # Memories -------------------------------------------------------------------------------
    # Memories belong to the couple, not to imported listening: they stay until their author
    # deletes them or the room is deleted, even if a disconnect removes the song's entries.

    def add_memory(self, room_id, role, target, date, text):
        if type(target) is not str or not MEMORY_TARGET.fullmatch(target):
            raise DomainError(404, 'That song or moment is not on this timeline.')
        date, text = _date(date), _text(text, 1000, 'Memory')
        with self._transaction() as db:
            kind, ident = target.split('-', 1)
            if kind == 'track':
                row = db.execute('SELECT title, artists FROM tracks WHERE room_id=? AND track_id=?', (room_id, ident)).fetchone()
                label = row and (f'{row[0]} — {row[1]}' if row[1] else row[0])
            else:
                row = db.execute('SELECT title FROM manual WHERE room_id=? AND id=?', (room_id, ident)).fetchone()
                label = row and row[0]
            if not label:
                raise DomainError(404, 'That song or moment is not on this timeline.')
            if db.execute('SELECT count(*) FROM song_memories WHERE room_id=?', (room_id,)).fetchone()[0] >= MAX_MEMORIES:
                raise DomainError(409, 'This timeline already has 300 memories. Delete one before adding another.')
            memory_id = uuid.uuid4().hex
            db.execute('INSERT INTO song_memories VALUES (?,?,?,?,?,?,?,NULL,?)',
                       (memory_id, room_id, target, label[:300], role, date, text, self.now() * 1000))
        return memory_id

    def _own_memory(self, db, room_id, role, memory_id):
        if type(memory_id) is not str or not _ID.fullmatch(memory_id):
            raise DomainError(404, 'Memory not found.')
        row = db.execute('SELECT author, photo FROM song_memories WHERE id=? AND room_id=?', (memory_id, room_id)).fetchone()
        if row is None:
            raise DomainError(404, 'Memory not found.')
        if row[0] != role:
            raise DomainError(403, 'Only the person who added this memory can change it.')
        return row[1]

    def update_memory(self, room_id, role, memory_id, date, text):
        date, text = _date(date), _text(text, 1000, 'Memory')
        with self._transaction() as db:
            self._own_memory(db, room_id, role, memory_id)
            db.execute('UPDATE song_memories SET date=?, text=? WHERE id=?', (date, text, memory_id))

    def delete_memory(self, room_id, role, memory_id):
        """Returns the deleted photo's type so the caller can remove the file."""
        with self._transaction() as db:
            photo = self._own_memory(db, room_id, role, memory_id)
            db.execute('DELETE FROM song_memories WHERE id=?', (memory_id,))
        return photo

    def set_photo(self, room_id, role, memory_id, mime):
        """Records a photo type; returns the previous type, whose file the caller replaces."""
        if mime is not None and mime not in PHOTO_TYPES:
            raise DomainError(400, 'Use a JPEG, PNG, WebP or GIF photo.')
        with self._transaction() as db:
            previous = self._own_memory(db, room_id, role, memory_id)
            db.execute('UPDATE song_memories SET photo=? WHERE id=?', (mime, memory_id))
        return previous

    def photo(self, room_id, memory_id):
        if type(memory_id) is not str or not _ID.fullmatch(memory_id):
            return None
        with self._transaction() as db:
            row = db.execute('SELECT photo FROM song_memories WHERE id=? AND room_id=?', (memory_id, room_id)).fetchone()
        return row[0] if row else None

    # Reading ----------------------------------------------------------------------------------

    def state(self, room_id, *, configured, include_hidden=False):
        with self._transaction() as db:
            connections = {role: None for role in ROLES}
            for role, name, connected_at, synced_at, error, scope in db.execute(
                    'SELECT c.role, c.display_name, c.connected_at, c.synced_at, c.sync_error, g.scope FROM connections c '
                    'LEFT JOIN grants g ON g.room_id=c.room_id AND g.role=c.role WHERE c.room_id=?', (room_id,)):
                connections[role] = {'displayName': name, 'connectedAt': connected_at * 1000,
                                     'syncedAt': synced_at * 1000 if synced_at else None, 'error': error,
                                     'canCreatePlaylists': bool(scope) and PLAYLIST_SCOPE in scope.split()}
            playlists = [{'id': row[0], 'role': row[1], 'name': row[2], 'url': row[3], 'tracks': row[4], 'createdAt': row[5] * 1000}
                         for row in db.execute('SELECT id, role, name, url, tracks, created_at FROM playlists WHERE room_id=? '
                                               'ORDER BY created_at DESC', (room_id,))]
            failures = {role: message for role, message, at in db.execute(
                'SELECT role, message, at FROM auth_failures WHERE room_id=?', (room_id,)) if self.now() - at < STATE_SECONDS}
            tracks = {row[0]: {'id': row[0], 'title': row[1], 'artists': row[2], 'album': row[3], 'url': row[4]}
                      for row in db.execute('SELECT track_id, title, artists, album, url FROM tracks WHERE room_id=?', (room_id,))}
            seen = {(row[0], row[1]): {'firstAt': row[2], 'lastAt': row[3], 'plays': row[4], 'baseline': bool(row[5])}
                    for row in db.execute('SELECT role, track_id, first_at, last_at, plays, baseline FROM seen WHERE room_id=?', (room_id,))}
            plays = {}
            for role, track_id, played_at in db.execute('SELECT role, track_id, played_at FROM plays WHERE room_id=?', (room_id,)):
                plays.setdefault((role, track_id), []).append(played_at)
            likes = {(row[0], row[1]): {'addedAt': row[2], 'baseline': bool(row[3])}
                     for row in db.execute('SELECT role, track_id, added_at, baseline FROM likes WHERE room_id=?', (room_id,))}
            overrides = {row[0]: {'hidden': bool(row[1]), 'caption': row[2]}
                         for row in db.execute('SELECT entry_key, hidden, caption FROM overrides WHERE room_id=?', (room_id,))}
            manual = [{'id': row[0], 'author': row[1], 'date': row[2], 'title': row[3], 'song': row[4], 'note': row[5],
                       'createdAt': row[6]}
                      for row in db.execute('SELECT id, author, date, title, song, note, created_at FROM manual WHERE room_id=?', (room_id,))]
            memories = [{'id': row[0], 'target': row[1], 'label': row[2], 'role': row[3], 'date': row[4], 'text': row[5],
                         'photo': row[6] is not None, 'createdAt': row[7]}
                        for row in db.execute('SELECT id, target, label, author, date, text, photo, created_at FROM song_memories '
                                              'WHERE room_id=? ORDER BY date DESC, created_at DESC', (room_id,))]
        entries = derive_timeline(tracks=tracks, seen=seen, plays=plays, likes=likes, overrides=overrides, manual=manual)
        # Every entry for a song shows that song's memories, so they can be revisited wherever it appears.
        by_target = {}
        for memory in memories:
            by_target.setdefault(memory['target'], []).append(memory)
        for entry in entries:
            target = f'manual-{entry["id"]}' if entry['kind'] == 'manual' else f'track-{entry["track"]["id"]}'
            entry['memoryTarget'] = target
            entry['memories'] = by_target.get(target, [])
        hidden = sum(entry['hidden'] for entry in entries)
        visible = entries if include_hidden else [entry for entry in entries if not entry['hidden']]
        return {'configured': configured, 'connections': connections, 'authFailures': failures,
                'entries': visible[:MAX_TIMELINE], 'hiddenCount': hidden, 'truncated': len(visible) > MAX_TIMELINE,
                'memories': memories, 'playlists': playlists}
