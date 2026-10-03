"""Atomic SQLite JSON records; only capability digests are persisted."""
from contextlib import contextmanager
import hashlib
import hmac
from pathlib import Path
import secrets
import sqlite3
import threading
import time
from typing import Callable

from .domain import DomainError as DomainError
from . import domain


class Store:
    def __init__(self, data_dir: Path, clock: Callable[[], float] = time.time):
        self._lock = threading.RLock()
        self._closed = False
        self._clock = clock
        self._connection = None
        try:
            directory = Path(data_dir)
            if directory.is_symlink() or (directory / 'challenges.sqlite3').is_symlink():
                raise DomainError('internal_error', 'Use a real data directory and database, not symlinks.', 500)
            directory.mkdir(parents=True, exist_ok=True)
            self._connection = sqlite3.connect(directory / 'challenges.sqlite3', timeout=5, check_same_thread=False, isolation_level=None)
            with self._transaction() as connection:
                version = connection.execute('PRAGMA user_version').fetchone()[0]
                tables = connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
                if version == 0 and not tables:
                    connection.execute('CREATE TABLE challenges (id TEXT PRIMARY KEY NOT NULL, record TEXT NOT NULL)')
                    connection.execute('PRAGMA user_version=1')
                elif version != 1 or tables != [('challenges',)]:
                    raise DomainError('internal_error', 'The challenge database schema is unsupported or corrupt.', 500)
                count = connection.execute('SELECT count(*) FROM challenges').fetchone()[0]
                domain.require(count <= 20, 'The stored challenge count exceeds supported limits.', 'internal_error', 500)
                for row in connection.execute('SELECT id, length(CAST(record AS BLOB)) FROM challenges'):
                    domain.require(type(row[1]) is int and row[1] <= domain.MAX_BYTES,
                                   'A stored record exceeds supported limits.', 'internal_error', 500)
                    self._load(connection, row[0], missing='internal_error')
        except (OSError, sqlite3.Error):
            if self._connection is not None:
                self._connection.close()
            self._closed = True
            raise DomainError('internal_error', 'The challenge database could not be opened safely.', 500) from None
        except Exception:
            if self._connection is not None:
                self._connection.close()
            self._closed = True
            raise

    @contextmanager
    def _transaction(self):
        with self._lock:
            if self._closed:
                raise RuntimeError('The challenge store is closed.')
            try:
                self._connection.execute('BEGIN IMMEDIATE')
                yield self._connection
                self._connection.execute('COMMIT')
            except sqlite3.Error:
                if self._connection.in_transaction:
                    self._connection.rollback()
                raise DomainError('internal_error', 'The challenge database operation failed. Your change was not published.', 500) from None
            except BaseException:
                if self._connection.in_transaction:
                    self._connection.rollback()
                raise

    @staticmethod
    def _digest(token):
        return hashlib.sha256(token.encode('ascii')).hexdigest()

    @staticmethod
    def _failure(code):
        if code == 'unauthorized':
            return DomainError(code, 'A valid seat capability is required.', 401)
        if code == 'not_found':
            return DomainError(code, 'That invitation is unavailable or has already been used.', 404)
        return DomainError('internal_error', 'Stored challenge data is corrupt or unsupported.', 500)

    def _load(self, connection, challenge_id, missing='unauthorized'):
        if type(challenge_id) is not str or domain.ID.fullmatch(challenge_id) is None:
            raise self._failure(missing)
        row = connection.execute(
            'SELECT CASE WHEN length(CAST(record AS BLOB)) <= ? THEN record ELSE NULL END, '
            'length(CAST(record AS BLOB)) FROM challenges WHERE id=?',
            (domain.MAX_BYTES, challenge_id)).fetchone()
        if row is None:
            raise self._failure(missing)
        try:
            domain.require(type(row[0]) is str and type(row[1]) is int and row[1] <= domain.MAX_BYTES,
                           'Stored record exceeds supported limits.')
            record = domain.validate_record(domain.parse_json(row[0]))
            domain.require(record['state']['id'] == challenge_id, 'Stored record ID mismatch.')
            return record
        except DomainError:
            raise self._failure('internal_error') from None

    def _authenticate(self, record, token):
        if type(token) is not str or domain.TOKEN.fullmatch(token) is None:
            raise self._failure('unauthorized')
        digest = self._digest(token)
        for role in domain.ROLES:
            saved = record['hashes'][role]
            if saved is not None and hmac.compare_digest(digest, saved):
                return role
        raise self._failure('unauthorized')

    @staticmethod
    def _write(connection, record, *, create=False):
        validated = domain.validate_record(record)
        encoded = domain.encode_json(validated)
        if create:
            connection.execute('INSERT INTO challenges(id,record) VALUES (?,?)', (validated['state']['id'], encoded))
        else:
            connection.execute('UPDATE challenges SET record=? WHERE id=?', (encoded, validated['state']['id']))

    def create(self, payload):
        with self._transaction() as connection:
            now = domain.timestamp(self._clock)
            challenge_id = secrets.token_hex(16)
            state = domain.create_state(challenge_id, payload, now)
            domain.require(connection.execute('SELECT count(*) FROM challenges').fetchone()[0] < 20,
                           'This data directory already contains 20 challenges. Export or back up its records before starting a separate notebook.', 'limit', 409)
            token, invitation = secrets.token_hex(32), secrets.token_hex(32)
            record = dict(schemaVersion=1, state=state,
                          hashes=dict(proposer=self._digest(token), opponent=None, arbiter=None,
                                      opponentInvite=self._digest(invitation), arbiterInvite=None))
            result = dict(challengeId=challenge_id, token=token, inviteToken=invitation,
                          challenge=domain.snapshot(record, 'proposer', now))
            domain.encode_json(result)
            self._write(connection, record, create=True)
            return result

    def join(self, challenge_id, payload):
        return self._join(challenge_id, payload, 'opponent')

    def join_arbiter(self, challenge_id, payload):
        return self._join(challenge_id, payload, 'arbiter')

    def _join(self, challenge_id, payload, seat):
        with self._transaction() as connection:
            domain.fields(payload, 'inviteToken name', 'Seat claim')
            supplied = payload['inviteToken']
            if type(supplied) is not str or domain.TOKEN.fullmatch(supplied) is None:
                raise self._failure('not_found')
            record = self._load(connection, challenge_id, missing='not_found')
            invitation = record['hashes'][seat + 'Invite']
            if invitation is None or not hmac.compare_digest(invitation, self._digest(supplied)):
                raise self._failure('not_found')
            now = domain.timestamp(self._clock)
            domain.apply_claim(record['state'], seat, payload['name'], now)
            token = secrets.token_hex(32)
            record['hashes'][seat], record['hashes'][seat + 'Invite'] = self._digest(token), None
            result = dict(challengeId=challenge_id, token=token, challenge=domain.snapshot(record, seat, now))
            domain.encode_json(result)
            self._write(connection, record)
            return result

    def get(self, challenge_id, token):
        with self._transaction() as connection:
            record = self._load(connection, challenge_id)
            role = self._authenticate(record, token)
            return domain.snapshot(record, role, domain.timestamp(self._clock))

    def command(self, challenge_id, token, action, payload):
        with self._transaction() as connection:
            record = self._load(connection, challenge_id)
            role = self._authenticate(record, token)
            now = domain.timestamp(self._clock)
            domain.apply_command(record['state'], role, action, payload, now)
            invitation = None
            if action == 'invite':
                invitation = secrets.token_hex(32)
                record['hashes'][payload['seat'] + 'Invite'] = self._digest(invitation)
            if action in ('arbiter/nominate', 'arbiter/withdraw'):
                record['hashes']['arbiterInvite'] = None
            if record['state']['status'] in domain.TERMINAL:
                record['hashes']['opponentInvite'] = record['hashes']['arbiterInvite'] = None
            public = domain.snapshot(record, role, now)
            result = dict(inviteToken=invitation, challenge=public) if action == 'invite' else public
            domain.encode_json(result)
            self._write(connection, record)
            return result

    def export(self, challenge_id, token):
        with self._transaction() as connection:
            record = self._load(connection, challenge_id)
            role = self._authenticate(record, token)
            now = domain.timestamp(self._clock)
            public = domain.snapshot(record, role, now)
            del public['myRole'], public['serverTime']
            result = dict(schemaVersion=1, exportedAt=now, challenge=public)
            domain.encode_json(result)
            return result

    def close(self):
        with self._lock:
            if not self._closed:
                self._closed = True
                self._connection.close()
