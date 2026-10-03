"""Transactional private rooms, explainable preferences, and anchored playback."""

from contextlib import contextmanager
from datetime import date as calendar_date
import hashlib
import hmac
import json
import math
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
from typing import Callable
import uuid

MAX_ROOMS = 5
MAX_TRACKS = 12
MAX_MEMORIES = 100
MAX_EXPORT_BYTES = 256 * 1024
_ID = re.compile(r'[0-9a-f]{32}\Z')
_TOKEN = re.compile(r'[0-9a-f]{64}\Z')


class DomainError(ValueError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _text(value, limit, label, *, empty=False):
    if (type(value) is not str or len(value) > limit or '\0' in value
            or (not empty and not value.strip())):
        raise DomainError(400, f'{label} must contain {"0" if empty else "1"}–{limit} characters without NUL bytes.')
    try:
        value.encode('utf-8')
    except UnicodeError:
        raise DomainError(400, f'{label} must contain valid Unicode text.') from None
    return value


def _number(value, minimum, maximum, label):
    if type(value) not in (int, float):
        raise DomainError(400, f'{label} must be a finite number between {minimum} and {maximum}.')
    try:
        valid = math.isfinite(value) and minimum <= value <= maximum
    except OverflowError:
        valid = False
    if not valid:
        raise DomainError(400, f'{label} must be a finite number between {minimum} and {maximum}.')
    return float(value)


def _id(value, label='ID'):
    if type(value) is not str or not _ID.fullmatch(value):
        raise DomainError(400, f'{label} must contain 32 lowercase hexadecimal characters.')
    return value


def _hash(token):
    return hashlib.sha256(token.encode('ascii')).hexdigest()


def _matches(token, digest):
    return (type(token) is str and bool(_TOKEN.fullmatch(token))
            and type(digest) is str and hmac.compare_digest(_hash(token), digest))


def _date(value):
    if type(value) is not str or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        raise DomainError(400, 'Memory date must use YYYY-MM-DD.')
    try:
        parsed = calendar_date.fromisoformat(value)
        if not 1900 <= parsed.year <= 2100:
            raise ValueError()
    except ValueError:
        raise DomainError(400, 'Memory date must be a valid calendar date from 1900 through 2100.') from None
    return value


def _validate_record(room, expected_id):
    """Reject corrupt on-disk state without repairing, dropping, or exposing it."""
    def require(condition):
        if not condition:
            raise ValueError('Invalid saved metadata')

    def fields(value, names):
        require(type(value) is dict and set(value) == set(names.split()))

    def revision(value):
        require(type(value) is int and value >= 0)

    def timestamp(value):
        _number(value, 0, 1e15, 'Timestamp')

    try:
        fields(room, 'schemaVersion id title createdAt profiles capabilities inviteHash tracks ratings playlist playlistRevision playback memories')
        require(type(room['schemaVersion']) is int and room['schemaVersion'] == 1)
        require(_id(room['id']) == expected_id)
        _text(room['title'], 80, 'Room title')
        timestamp(room['createdAt'])
        fields(room['profiles'], 'host guest')
        fields(room['capabilities'], 'host guest')
        for role in ('host', 'guest'):
            profile, capability = room['profiles'][role], room['capabilities'][role]
            if role == 'guest' and profile is None:
                require(capability is None)
                continue
            fields(profile, 'name')
            _text(profile['name'], 40, 'Participant name')
            require(type(capability) is str and bool(_TOKEN.fullmatch(capability)))
        if room['profiles']['guest'] is None:
            require(type(room['inviteHash']) is str and bool(_TOKEN.fullmatch(room['inviteHash'])))
        else:
            require(room['inviteHash'] is None)
        require(type(room['tracks']) is list and len(room['tracks']) <= MAX_TRACKS)
        tracks = {}
        for track in room['tracks']:
            fields(track, 'id title artist duration uploadedBy createdAt')
            track_id = _id(track['id'])
            require(track_id not in tracks)
            _text(track['title'], 80, 'Track title')
            _text(track['artist'], 80, 'Artist', empty=True)
            _number(track['duration'], 1, 300, 'Duration')
            require(track['uploadedBy'] in ('host', 'guest'))
            require(room['profiles'][track['uploadedBy']] is not None)
            timestamp(track['createdAt'])
            tracks[track_id] = track
        require(type(room['ratings']) is dict and set(room['ratings']) == set(tracks))
        for votes in room['ratings'].values():
            fields(votes, 'host guest')
            require(all(type(vote) is int and vote in (-1, 0, 1) for vote in votes.values()))
            require(room['profiles']['guest'] is not None or votes['guest'] == 0)
        require(type(room['playlist']) is list and len(room['playlist']) <= MAX_TRACKS)
        require(all(type(item) is str and item in tracks for item in room['playlist']))
        require(len(set(room['playlist'])) == len(room['playlist']))
        revision(room['playlistRevision'])
        playback = room['playback']
        fields(playback, 'trackId playing position revision updatedAt')
        revision(playback['revision'])
        timestamp(playback['updatedAt'])
        require(type(playback['playing']) is bool)
        if playback['trackId'] is None:
            require(not playback['playing'])
            _number(playback['position'], 0, 0, 'Playback position')
        else:
            require(type(playback['trackId']) is str and playback['trackId'] in tracks)
            _number(playback['position'], 0, tracks[playback['trackId']]['duration'], 'Playback position')
        require(type(room['memories']) is list and len(room['memories']) <= MAX_MEMORIES)
        memories = set()
        for memory in room['memories']:
            fields(memory, 'id trackId trackTitle date text author createdAt')
            memory_id = _id(memory['id'])
            require(memory_id not in memories)
            memories.add(memory_id)
            _id(memory['trackId'])
            _text(memory['trackTitle'], 80, 'Memory track title')
            _text(memory['text'], 500, 'Memory')
            _date(memory['date'])
            require(memory['author'] in ('host', 'guest'))
            require(room['profiles'][memory['author']] is not None)
            timestamp(memory['createdAt'])
    except (ValueError, KeyError, TypeError, RecursionError):
        raise DomainError(500, 'Saved room metadata is invalid. Preserve rooms.sqlite3 and recover a valid backup before starting the service.') from None
    return room


def rank_tracks(tracks, ratings):
    """Rank only explicit votes; missing votes mean unrated, never dislike."""
    categories = {'mutual': 0, 'discovery': 1, 'unrated': 2, 'mixed': 3, 'avoid': 4}
    result = []
    for track in tracks:
        votes = ratings.get(track['id'], {})
        pair = sorted((votes.get('host', 0), votes.get('guest', 0)))
        if pair == [1, 1]:
            category, reason = 'mutual', 'Both participants liked this track.'
        elif pair == [0, 1]:
            category, reason = 'discovery', 'One participant liked this track; the other has not rated it.'
        elif pair == [0, 0]:
            category, reason = 'unrated', 'Neither participant has rated this track.'
        elif pair == [-1, 1]:
            category, reason = 'mixed', 'One participant liked this track and the other disliked it.'
        else:
            category, reason = 'avoid', 'At least one participant disliked this track and neither liked it; excluded from the mix.'
        result.append((categories[category], track['createdAt'], track['id'],
                       {'trackId': track['id'], 'category': category, 'reason': reason}))
    return [item[3] for item in sorted(result)]


def effective_playback(room, now):
    """Resolve a private millisecond anchor at ``now`` (clock seconds)."""
    anchor = room['playback']
    tracks = {track['id']: track for track in room['tracks']}
    current = anchor['trackId']
    if current is None or current not in tracks:
        return {'trackId': None, 'playing': False, 'position': 0.0, 'revision': anchor['revision']}
    playing = anchor['playing']
    position = anchor['position']
    if playing:
        position += max(0.0, now * 1000 - anchor['updatedAt']) / 1000
    playlist = room['playlist']
    revision = anchor['revision']
    while playing and position >= tracks[current]['duration']:
        revision += 1
        index = playlist.index(current) if current in playlist else -1
        if index < 0 or index + 1 >= len(playlist):
            position = tracks[current]['duration']
            playing = False
            break
        position -= tracks[current]['duration']
        current = playlist[index + 1]
    return {'trackId': current, 'playing': playing,
            'position': min(position, tracks[current]['duration']), 'revision': revision}


class Store:
    """SQLite owns atomic state; callers own the data-directory lifetime lock.

    Every operation uses BEGIN IMMEDIATE, including snapshot reads, so multiple
    Store connections cannot claim an invite or overwrite a revision together.
    Returned values are fresh objects and never expose stored capabilities.
    """

    def __init__(self, data_dir: Path, now: Callable[[], float] = time.time):
        self.now = now
        self.lock = threading.RLock()
        directory = Path(data_dir)
        directory.mkdir(parents=True, exist_ok=True)
        self.database = sqlite3.connect(directory / 'rooms.sqlite3', timeout=10,
                                       isolation_level=None, check_same_thread=False)
        self.database.execute('PRAGMA journal_mode=WAL')
        self.database.execute('PRAGMA synchronous=FULL')
        self.database.execute('CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, document TEXT NOT NULL)')
        self.closed = False
        try:
            with self._transaction():
                rows = self.database.execute('SELECT id FROM rooms').fetchall()
                if len(rows) > MAX_ROOMS:
                    raise DomainError(500, 'Saved room metadata exceeds the five-room limit; existing data was preserved.')
                for (room_id,) in rows:
                    self._read(room_id)
        except BaseException:
            self.close()
            raise

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
                raise DomainError(500, 'Room storage is unavailable. Keep your current edits and try again.') from None
            try:
                yield
                self.database.execute('COMMIT')
            except BaseException as error:
                try:
                    self.database.execute('ROLLBACK')
                except sqlite3.Error:
                    pass
                if isinstance(error, sqlite3.Error):
                    raise DomainError(500, 'The room could not be saved or read. Keep your current edits and check local storage.') from None
                raise

    def _clock(self):
        return _number(self.now(), 0, 1e12, 'Server clock')

    def _read(self, room_id):
        if type(room_id) is not str or not _ID.fullmatch(room_id):
            raise DomainError(404, 'Room not found.')
        row = self.database.execute(
            'SELECT CASE WHEN length(CAST(document AS BLOB)) <= ? THEN document ELSE NULL END FROM rooms WHERE id=?',
            (MAX_EXPORT_BYTES, room_id)).fetchone()
        if row is None:
            raise DomainError(404, 'Room not found.')
        try:
            def pairs(items):
                result = {}
                for key, value in items:
                    if key in result:
                        raise ValueError('Duplicate saved key')
                    result[key] = value
                return result
            room = json.loads(row[0], object_pairs_hook=pairs)
        except (ValueError, TypeError, RecursionError):
            raise DomainError(500, 'Saved room metadata is invalid or too large; existing data was preserved.') from None
        return _validate_record(room, room_id)

    def _write(self, room):
        _validate_record(room, room['id'])
        encoded = json.dumps(room, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
        if len(encoded.encode('utf-8')) > MAX_EXPORT_BYTES:
            raise DomainError(400, 'Room metadata exceeds the 256 KiB storage limit.')
        self.database.execute('INSERT INTO rooms(id, document) VALUES (?, ?) '
                              'ON CONFLICT(id) DO UPDATE SET document=excluded.document', (room['id'], encoded))

    def _role(self, room, token):
        for role in ('host', 'guest'):
            if _matches(token, room['capabilities'][role]):
                return role
        raise DomainError(401, 'A valid room participant capability is required.')

    def _authorized(self, room_id, token):
        room = self._read(room_id)
        return room, self._role(room, token)

    def _snapshot(self, room, role, now):
        playback = effective_playback(room, now)
        if playback['revision'] != room['playback']['revision']:
            # Persist semantic transitions once, so later polls/connections and
            # a backwards clock cannot return an earlier transport generation.
            room['playback'] = {**playback, 'updatedAt': now * 1000}
            self._write(room)
        # Round-trip the public fields so callers cannot mutate any shared value.
        result = {key: room[key] for key in ('id', 'title', 'createdAt', 'profiles', 'tracks',
                                            'ratings', 'playlist', 'playlistRevision', 'memories')}
        result.update(myRole=role, serverTime=now * 1000, blend=rank_tracks(room['tracks'], room['ratings']),
                      playback=playback)
        return json.loads(json.dumps(result, ensure_ascii=False, allow_nan=False))

    @staticmethod
    def _revision(value, actual):
        if type(value) is not int or value < 0:
            raise DomainError(400, 'Revision must be a nonnegative integer.')
        if value != actual:
            raise DomainError(409, 'The room changed. Refresh its latest state before retrying this command.')

    @staticmethod
    def _track(room, track_id):
        for track in room['tracks']:
            if track['id'] == track_id:
                return track
        raise DomainError(404, 'Track not found in this room.')

    @staticmethod
    def _anchor(room, now):
        room['playback'] = {**effective_playback(room, now), 'updatedAt': now * 1000}

    def create_room(self, title, name):
        title, name = _text(title, 80, 'Room title'), _text(name, 40, 'Participant name')
        with self._transaction():
            if self.database.execute('SELECT count(*) FROM rooms').fetchone()[0] >= MAX_ROOMS:
                raise DomainError(409, 'The five-room limit has been reached. Delete a room you own before creating another.')
            now = self._clock()
            room_id, token, invite = uuid.uuid4().hex, secrets.token_hex(32), secrets.token_hex(32)
            room = {'schemaVersion': 1, 'id': room_id, 'title': title, 'createdAt': now * 1000,
                    'profiles': {'host': {'name': name}, 'guest': None},
                    'capabilities': {'host': _hash(token), 'guest': None}, 'inviteHash': _hash(invite),
                    'tracks': [], 'ratings': {}, 'playlist': [], 'playlistRevision': 0, 'memories': [],
                    'playback': {'trackId': None, 'playing': False, 'position': 0.0, 'revision': 0, 'updatedAt': now * 1000}}
            self._write(room)
            return {'roomId': room_id, 'token': token, 'inviteToken': invite, 'room': self._snapshot(room, 'host', now)}

    def join_room(self, room_id, invite_token, name):
        name = _text(name, 40, 'Participant name')
        with self._transaction():
            room = self._read(room_id)
            if room['profiles']['guest'] is not None:
                raise DomainError(409, 'Both participant places are already occupied.')
            if not _matches(invite_token, room['inviteHash']):
                raise DomainError(401, 'This invitation is invalid or has been replaced.')
            token = secrets.token_hex(32)
            room['profiles']['guest'] = {'name': name}
            room['capabilities']['guest'] = _hash(token)
            room['inviteHash'] = None
            self._write(room)
            return {'roomId': room_id, 'token': token, 'room': self._snapshot(room, 'guest', self._clock())}

    def authenticate(self, room_id, token):
        with self._transaction():
            return self._authorized(room_id, token)[1]

    def snapshot(self, room_id, token):
        with self._transaction():
            room, role = self._authorized(room_id, token)
            return self._snapshot(room, role, self._clock())

    def rotate_invite(self, room_id, token):
        with self._transaction():
            room, role = self._authorized(room_id, token)
            if role != 'host':
                raise DomainError(403, 'Only the host can replace the invitation.')
            if room['profiles']['guest'] is not None:
                raise DomainError(409, 'Both participant places are already occupied.')
            invite = secrets.token_hex(32)
            room['inviteHash'] = _hash(invite)
            self._write(room)
            return {'inviteToken': invite}

    def rate(self, room_id, token, track_id, rating):
        with self._transaction():
            room, role = self._authorized(room_id, token)
            self._track(room, track_id)
            if type(rating) is not int or rating not in (-1, 0, 1):
                raise DomainError(400, 'Rating must be -1 (dislike), 0 (unrated), or 1 (like).')
            room['ratings'][track_id][role] = rating
            self._write(room)
            return self._snapshot(room, role, self._clock())

    def _playlist(self, room_id, token, track_ids, revision, build):
        with self._transaction():
            room, role = self._authorized(room_id, token)
            self._revision(revision, room['playlistRevision'])
            if build:
                track_ids = [item['trackId'] for item in rank_tracks(room['tracks'], room['ratings']) if item['category'] != 'avoid']
            if type(track_ids) is not list or len(track_ids) > MAX_TRACKS:
                raise DomainError(400, 'Playlist must be a list of at most twelve track IDs.')
            for track_id in track_ids:
                _id(track_id, 'Track ID')
                self._track(room, track_id)
            if len(set(track_ids)) != len(track_ids):
                raise DomainError(400, 'Playlist track IDs must be unique.')
            now = self._clock()
            self._anchor(room, now)
            room['playlist'] = list(track_ids)
            room['playlistRevision'] += 1
            self._write(room)
            return self._snapshot(room, role, now)

    def build_playlist(self, room_id, token, revision):
        return self._playlist(room_id, token, None, revision, True)

    def set_playlist(self, room_id, token, track_ids, revision):
        return self._playlist(room_id, token, track_ids, revision, False)

    def set_playback(self, room_id, token, track_id, playing, position, revision):
        with self._transaction():
            room, role = self._authorized(room_id, token)
            now = self._clock()
            self._revision(revision, effective_playback(room, now)['revision'])
            if type(playing) is not bool:
                raise DomainError(400, 'Playing must be a boolean.')
            duration = self._track(room, track_id)['duration'] if track_id is not None else 0
            position = _number(position, 0, duration, 'Playback position')
            if track_id is None and playing:
                raise DomainError(400, 'Playback without a selected track must be paused at position zero.')
            room['playback'] = {'trackId': track_id, 'playing': playing, 'position': position,
                                'revision': revision + 1, 'updatedAt': now * 1000}
            self._write(room)
            return self._snapshot(room, role, now)

    def add_track(self, room_id, token, track_id, title, artist, duration):
        _id(track_id, 'Track ID')
        title, artist = _text(title, 80, 'Track title'), _text(artist, 80, 'Artist', empty=True)
        duration = _number(duration, 1, 300, 'Track duration')
        with self._transaction():
            room, role = self._authorized(room_id, token)
            if len(room['tracks']) >= MAX_TRACKS:
                raise DomainError(409, 'This room already has twelve tracks. Delete a track before uploading another.')
            if any(track['id'] == track_id for track in room['tracks']):
                raise DomainError(409, 'This track ID already exists in the room.')
            now = self._clock()
            room['tracks'].append({'id': track_id, 'title': title, 'artist': artist, 'duration': duration,
                                   'uploadedBy': role, 'createdAt': now * 1000})
            room['ratings'][track_id] = {'host': 0, 'guest': 0}
            self._write(room)
            return self._snapshot(room, role, now)

    def delete_track(self, room_id, token, track_id):
        with self._transaction():
            room, role = self._authorized(room_id, token)
            track = self._track(room, track_id)
            if role != 'host' and role != track['uploadedBy']:
                raise DomainError(403, 'Only the uploader or host can delete this track.')
            now = self._clock()
            self._anchor(room, now)
            if room['playback']['trackId'] == track_id:
                room['playback'] = {'trackId': None, 'playing': False, 'position': 0.0,
                                    'revision': room['playback']['revision'] + 1, 'updatedAt': now * 1000}
            room['tracks'] = [item for item in room['tracks'] if item['id'] != track_id]
            del room['ratings'][track_id]
            room['playlist'] = [item for item in room['playlist'] if item != track_id]
            room['playlistRevision'] += 1
            self._write(room)
            return self._snapshot(room, role, now)

    def add_memory(self, room_id, token, track_id, date, text):
        text = _text(text, 500, 'Memory')
        date = _date(date)
        with self._transaction():
            room, role = self._authorized(room_id, token)
            track = self._track(room, track_id)
            if len(room['memories']) >= MAX_MEMORIES:
                raise DomainError(409, 'This room already has one hundred memories. Delete one before adding another.')
            now = self._clock()
            room['memories'].append({'id': uuid.uuid4().hex, 'trackId': track_id, 'trackTitle': track['title'],
                                     'date': date, 'text': text, 'author': role, 'createdAt': now * 1000})
            self._write(room)
            return self._snapshot(room, role, now)

    def delete_memory(self, room_id, token, memory_id):
        with self._transaction():
            room, role = self._authorized(room_id, token)
            memory = next((item for item in room['memories'] if item['id'] == memory_id), None)
            if memory is None:
                raise DomainError(404, 'Memory not found in this room.')
            if memory['author'] != role:
                raise DomainError(403, 'Only the author can delete this memory.')
            room['memories'].remove(memory)
            self._write(room)
            return self._snapshot(room, role, self._clock())

    def export_room(self, room_id, token):
        snapshot = self.snapshot(room_id, token)
        del snapshot['myRole'], snapshot['serverTime']
        exported = {'schemaVersion': 1, **snapshot}
        if len(json.dumps(exported, ensure_ascii=False).encode('utf-8')) > MAX_EXPORT_BYTES:
            raise DomainError(400, 'Room export exceeds the 256 KiB limit.')
        return exported

    def delete_room(self, room_id, token):
        with self._transaction():
            _, role = self._authorized(room_id, token)
            if role != 'host':
                raise DomainError(403, 'Only the host can delete this room.')
            self.database.execute('DELETE FROM rooms WHERE id=?', (room_id,))

    def pause_all(self):
        with self._transaction():
            now = self._clock()
            rows = self.database.execute('SELECT id FROM rooms').fetchall()
            for (room_id,) in rows:
                room = self._read(room_id)
                self._anchor(room, now)
                if room['playback']['playing']:
                    room['playback']['revision'] += 1
                room['playback']['playing'] = False
                self._write(room)
