"""Friend circles: a shared feed of friendly challenges that both participants chose to share.

Circles live in their own owner-only ``circles.sqlite3``; challenge records are never changed.
Members hold random capabilities (only digests are stored). A challenge appears in a circle only
after both the proposer and the opponent consent with their own seat capability; either can
withdraw it, which removes it from the feed. Feed items are derived from the challenge's public
record. Evidence images stay private to the challenge's seats.
"""

from contextlib import contextmanager
import hashlib
import hmac
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time

from . import domain
from .domain import DomainError

MAX_CIRCLES = 10
MAX_MEMBERS = 12
MAX_COMMENTS = 500
EXCERPT = 280
ID = re.compile(r'[0-9a-f]{32}\Z')
TOKEN = re.compile(r'[0-9a-f]{64}\Z')
ITEM = re.compile(r'[0-9a-f]{32}-(?:[0-9]{1,6}|final)\Z')
STAKE_LABELS = {'bragging-rights': 'bragging rights', 'make-a-drink': 'making a drink', 'pick-a-movie': 'picking a movie',
                'do-the-dishes': 'doing the dishes'}

SCHEMA = '''
CREATE TABLE IF NOT EXISTS circles (id TEXT PRIMARY KEY, name TEXT NOT NULL, invite_hash TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS members (circle_id TEXT NOT NULL, member_id TEXT NOT NULL, name TEXT NOT NULL,
  token_hash TEXT NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY (circle_id, member_id));
CREATE TABLE IF NOT EXISTS shares (circle_id TEXT NOT NULL, challenge_id TEXT NOT NULL, role TEXT NOT NULL,
  member_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (circle_id, challenge_id, role));
CREATE TABLE IF NOT EXISTS cheers (circle_id TEXT NOT NULL, item TEXT NOT NULL, member_id TEXT NOT NULL,
  at INTEGER NOT NULL, PRIMARY KEY (circle_id, item, member_id));
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, circle_id TEXT NOT NULL, challenge_id TEXT NOT NULL,
  member_id TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
'''


def _digest(token):
    return hashlib.sha256(token.encode('ascii')).hexdigest()


def _excerpt(value):
    value = ' '.join(value.split())
    return value if len(value) <= EXCERPT else value[:EXCERPT - 1].rstrip() + '…'


def feed_items(state):
    """Public feed items for one shared challenge, derived from its append-only events."""
    names = {role: (profile or {}).get('name') for role, profile in state['profiles'].items()}
    title = state['terms']['title']
    items = []
    for event in state['events']:
        kind, details, actor = event['kind'], event['details'], event['actor']
        base = {'key': f'{state["id"]}-{event["seq"]}', 'challengeId': state['id'], 'at': event['at'], 'title': title}
        if kind == 'accepted':
            items.append({**base, 'kind': 'agreed', 'proposer': names['proposer'], 'opponent': names['opponent'],
                          'stake': STAKE_LABELS.get(state['terms']['stake'], state['terms']['stake']),
                          'deadline': state['terms']['deadline'], 'successCriteria': _excerpt(state['terms']['successCriteria'])})
        elif kind in ('evidence_added', 'evidence_image_added'):
            evidence = details['evidence']
            items.append({**base, 'kind': 'progress', 'by': names.get(actor), 'text': _excerpt(evidence.get('text', '')),
                          'photo': 'image' in evidence or kind == 'evidence_image_added', 'late': bool(evidence.get('late'))})
        elif kind == 'result_responded' and not details['accept']:
            items.append({**base, 'kind': 'disputed', 'by': names.get(actor)})
        elif kind in ('declined', 'withdrawn'):
            items.append({**base, 'kind': kind, 'by': names.get(actor)})
    resolution = state['resolution']
    if resolution is not None:
        outcome = resolution['outcome']
        items.append({'key': f'{state["id"]}-final', 'challengeId': state['id'], 'at': resolution['decidedAt'], 'title': title,
                      'kind': 'voided' if outcome == 'void' else 'settled',
                      'winner': None if outcome == 'void' else names.get(outcome),
                      'method': resolution['method'], 'reason': _excerpt(resolution.get('reason') or '')})
    return items


class Circles:
    def __init__(self, data_dir: Path, challenges, clock=time.time):
        """``challenges`` provides ``seat_role(challenge_id, token)`` and ``public_state(challenge_id)``."""
        self.challenges = challenges
        self.clock = clock
        self.lock = threading.RLock()
        path = Path(data_dir) / 'circles.sqlite3'
        descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        os.close(descriptor)
        os.chmod(path, 0o600, follow_symlinks=False)
        self.db = sqlite3.connect(path, timeout=5, check_same_thread=False, isolation_level=None)
        self.db.execute('PRAGMA journal_mode=DELETE')
        self.db.executescript(SCHEMA)
        self.closed = False

    def close(self):
        with self.lock:
            if not self.closed:
                self.db.close()
                self.closed = True

    @contextmanager
    def _transaction(self):
        with self.lock:
            try:
                self.db.execute('BEGIN IMMEDIATE')
            except sqlite3.Error:
                raise DomainError('internal_error', 'Circle storage is unavailable. Try again.', 500) from None
            try:
                yield self.db
                self.db.execute('COMMIT')
            except BaseException as error:
                try:
                    self.db.execute('ROLLBACK')
                except sqlite3.Error:
                    pass
                if isinstance(error, sqlite3.Error):
                    raise DomainError('internal_error', 'Circle data could not be saved or read.', 500) from None
                raise

    def _now(self):
        return int(self.clock() * 1000)

    def _member(self, db, circle_id, token):
        if type(circle_id) is not str or not ID.fullmatch(circle_id) or type(token) is not str or not TOKEN.fullmatch(token):
            raise DomainError('unauthorized', 'A valid circle member capability is required.', 401)
        digest = _digest(token)
        for member_id, saved in db.execute('SELECT member_id, token_hash FROM members WHERE circle_id=?', (circle_id,)):
            if hmac.compare_digest(saved, digest):
                return member_id
        raise DomainError('unauthorized', 'A valid circle member capability is required.', 401)

    # Membership --------------------------------------------------------------------------

    def create(self, payload):
        domain.fields(payload, 'circleName name', 'Circle')
        circle_name = domain.text(payload['circleName'], 60, 'Circle name', trim=True)
        name = domain.text(payload['name'], 40, 'Name', trim=True)
        token, invite = secrets.token_hex(32), secrets.token_hex(32)
        with self._transaction() as db:
            domain.require(db.execute('SELECT count(*) FROM circles').fetchone()[0] < MAX_CIRCLES,
                           'This notebook already has 10 circles.', 'limit', 409)
            circle_id, member_id = secrets.token_hex(16), secrets.token_hex(16)
            db.execute('INSERT INTO circles VALUES (?,?,?,?)', (circle_id, circle_name, _digest(invite), self._now()))
            db.execute('INSERT INTO members VALUES (?,?,?,?,?)', (circle_id, member_id, name, _digest(token), self._now()))
        return {'circleId': circle_id, 'token': token, 'inviteToken': invite, 'circle': self.view(circle_id, token)}

    def join(self, circle_id, payload):
        domain.fields(payload, 'inviteToken name', 'Circle join')
        name = domain.text(payload['name'], 40, 'Name', trim=True)
        invite = payload['inviteToken']
        token = secrets.token_hex(32)
        with self._transaction() as db:
            row = db.execute('SELECT invite_hash FROM circles WHERE id=?', (circle_id,)).fetchone() \
                if type(circle_id) is str and ID.fullmatch(circle_id) else None
            if (row is None or row[0] is None or type(invite) is not str or not TOKEN.fullmatch(invite)
                    or not hmac.compare_digest(row[0], _digest(invite))):
                raise DomainError('not_found', 'This circle invitation is invalid or was replaced.', 404)
            domain.require(db.execute('SELECT count(*) FROM members WHERE circle_id=?', (circle_id,)).fetchone()[0] < MAX_MEMBERS,
                           'This circle already has 12 members.', 'limit', 409)
            db.execute('INSERT INTO members VALUES (?,?,?,?,?)', (circle_id, secrets.token_hex(16), name, _digest(token), self._now()))
        return {'circleId': circle_id, 'token': token, 'circle': self.view(circle_id, token)}

    def invite(self, circle_id, token):
        """Any member can issue a fresh invitation; the previous one stops working."""
        invite = secrets.token_hex(32)
        with self._transaction() as db:
            self._member(db, circle_id, token)
            db.execute('UPDATE circles SET invite_hash=? WHERE id=?', (_digest(invite), circle_id))
        return {'inviteToken': invite}

    def leave(self, circle_id, token):
        with self._transaction() as db:
            member_id = self._member(db, circle_id, token)
            for table in ('members', 'cheers', 'comments'):
                db.execute(f'DELETE FROM {table} WHERE circle_id=? AND member_id=?', (circle_id, member_id))
            # Shares made by a departing member are withdrawn with them.
            db.execute('DELETE FROM shares WHERE circle_id=? AND member_id=?', (circle_id, member_id))
            if db.execute('SELECT count(*) FROM members WHERE circle_id=?', (circle_id,)).fetchone()[0] == 0:
                for table in ('shares', 'cheers', 'comments'):
                    db.execute(f'DELETE FROM {table} WHERE circle_id=?', (circle_id,))
                db.execute('DELETE FROM circles WHERE id=?', (circle_id,))
        return {'left': True}

    # Sharing -------------------------------------------------------------------------------

    def share(self, circle_id, token, payload):
        domain.fields(payload, 'challengeId seatToken', 'Share')
        challenge_id = payload['challengeId']
        # The seat capability proves which participant consents; arbiters cannot share.
        role = self.challenges.seat_role(challenge_id, payload['seatToken'])
        domain.require(role in domain.PARTIES, 'Only the two participants can share a challenge.', 'forbidden', 403)
        with self._transaction() as db:
            member_id = self._member(db, circle_id, token)
            db.execute('INSERT OR REPLACE INTO shares VALUES (?,?,?,?,?)', (circle_id, challenge_id, role, member_id, self._now()))
        return self.view(circle_id, token)

    def unshare(self, circle_id, token, payload):
        domain.fields(payload, 'challengeId seatToken', 'Share')
        challenge_id = payload['challengeId']
        role = self.challenges.seat_role(challenge_id, payload['seatToken'])
        domain.require(role in domain.PARTIES, 'Only the two participants can withdraw a shared challenge.', 'forbidden', 403)
        with self._transaction() as db:
            self._member(db, circle_id, token)
            # Either participant withdrawing removes the challenge and its conversation from the feed.
            for table in ('shares', 'comments'):
                db.execute(f'DELETE FROM {table} WHERE circle_id=? AND challenge_id=?', (circle_id, challenge_id))
            db.execute("DELETE FROM cheers WHERE circle_id=? AND item LIKE ?", (circle_id, f'{challenge_id}-%'))
        return self.view(circle_id, token)

    # Reactions -------------------------------------------------------------------------------

    def _visible(self, db, circle_id):
        rows = db.execute('SELECT challenge_id, role FROM shares WHERE circle_id=?', (circle_id,)).fetchall()
        roles = {}
        for challenge_id, role in rows:
            roles.setdefault(challenge_id, set()).add(role)
        return {challenge_id for challenge_id, consent in roles.items() if consent == set(domain.PARTIES)}, roles

    def cheer(self, circle_id, token, payload):
        domain.fields(payload, 'item', 'Cheer')
        item = payload['item']
        domain.require(type(item) is str and ITEM.fullmatch(item) is not None, 'That feed item is unavailable.')
        with self._transaction() as db:
            member_id = self._member(db, circle_id, token)
            visible, _ = self._visible(db, circle_id)
            domain.require(item.rsplit('-', 1)[0] in visible, 'That feed item is unavailable.', 'not_found', 404)
            if db.execute('DELETE FROM cheers WHERE circle_id=? AND item=? AND member_id=?', (circle_id, item, member_id)).rowcount == 0:
                db.execute('INSERT INTO cheers VALUES (?,?,?,?)', (circle_id, item, member_id, self._now()))
        return self.view(circle_id, token)

    def comment(self, circle_id, token, payload):
        domain.fields(payload, 'challengeId text', 'Comment')
        text = domain.text(payload['text'], 500, 'Comment', trim=True)
        with self._transaction() as db:
            member_id = self._member(db, circle_id, token)
            visible, _ = self._visible(db, circle_id)
            domain.require(payload['challengeId'] in visible, 'That challenge is not shared with this circle.', 'not_found', 404)
            domain.require(db.execute('SELECT count(*) FROM comments WHERE circle_id=?', (circle_id,)).fetchone()[0] < MAX_COMMENTS,
                           'This circle already has 500 comments.', 'limit', 409)
            db.execute('INSERT INTO comments VALUES (?,?,?,?,?,?)',
                       (secrets.token_hex(16), circle_id, payload['challengeId'], member_id, text, self._now()))
        return self.view(circle_id, token)

    def delete_comment(self, circle_id, token, payload):
        domain.fields(payload, 'commentId', 'Comment')
        with self._transaction() as db:
            member_id = self._member(db, circle_id, token)
            row = db.execute('SELECT member_id FROM comments WHERE id=? AND circle_id=?', (payload['commentId'], circle_id)).fetchone()
            domain.require(row is not None, 'That comment is unavailable.', 'not_found', 404)
            domain.require(row[0] == member_id, 'Only the person who wrote a comment can delete it.', 'forbidden', 403)
            db.execute('DELETE FROM comments WHERE id=?', (payload['commentId'],))
        return self.view(circle_id, token)

    # Reading ---------------------------------------------------------------------------------

    def view(self, circle_id, token):
        with self._transaction() as db:
            me = self._member(db, circle_id, token)
            name = db.execute('SELECT name FROM circles WHERE id=?', (circle_id,)).fetchone()[0]
            members = {row[0]: row[1] for row in db.execute(
                'SELECT member_id, name FROM members WHERE circle_id=? ORDER BY joined_at, rowid', (circle_id,))}
            visible, consents = self._visible(db, circle_id)
            cheers = {}
            for item, member_id in db.execute('SELECT item, member_id FROM cheers WHERE circle_id=?', (circle_id,)):
                cheers.setdefault(item, []).append(member_id)
            comments = {}
            for comment_id, challenge_id, member_id, text, at in db.execute(
                    'SELECT id, challenge_id, member_id, text, at FROM comments WHERE circle_id=? ORDER BY at', (circle_id,)):
                comments.setdefault(challenge_id, []).append(
                    {'id': comment_id, 'by': members.get(member_id, 'Former member'), 'mine': member_id == me, 'text': text, 'at': at})
        challenges, pending, feed = [], [], []
        for challenge_id in sorted(consents):
            if challenge_id not in visible:
                # Until both participants share, the circle learns nothing about the challenge itself;
                # the participants recognise it by its ID.
                pending.append({'id': challenge_id, 'consented': sorted(consents[challenge_id])})
                continue
            state = self.challenges.public_state(challenge_id)
            if state is None:
                continue  # The challenge no longer exists in this notebook.
            challenges.append({'id': challenge_id, 'title': state['terms']['title'], 'status': state['status'],
                               'proposer': state['profiles']['proposer']['name'],
                               'opponent': (state['profiles']['opponent'] or {}).get('name'),
                               'comments': comments.get(challenge_id, [])})
            for order, item in enumerate(feed_items(state)):
                item['cheers'] = [members[m] for m in cheers.get(item['key'], []) if m in members]
                item['cheeredByMe'] = me in cheers.get(item['key'], [])
                feed.append((item['at'], order, item))
        # Newest first; events recorded in the same millisecond keep their record order.
        feed = [item for _, _, item in sorted(feed, key=lambda entry: (entry[0], entry[1]), reverse=True)]
        return {'id': circle_id, 'name': name, 'me': me, 'members': [{'id': m, 'name': n} for m, n in members.items()],
                'challenges': challenges, 'pending': pending, 'feed': feed[:200]}
