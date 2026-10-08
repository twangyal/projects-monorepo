#!/usr/bin/env python3
"""Independent original ledgers + actual CLI/HTTP archive acceptance.

No archive/domain producer builds expected states or pixels. Capability material
is generated locally and confined to 0600 files in a 0700 output directory.
Run --fixtures-only before archive implementation exists; omit it only when the
coordinated runtime slot is available. No model, browser or existing service.
"""
from __future__ import annotations

import argparse
import base64
from copy import deepcopy
import hashlib
import html
import io
import json
import os
from pathlib import Path
import re
import secrets
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile

from PIL import Image

APP = Path(__file__).resolve().parents[1]
CREATED = 1704067200000  # 2024-01-01; historical admission, never today's consent.
DEADLINE = CREATED + 86400000
CHALLENGES_SQL = 'CREATE TABLE challenges (id TEXT PRIMARY KEY NOT NULL, record TEXT NOT NULL)'
IMAGES_SQL = "CREATE TABLE evidence_images (challenge_id TEXT NOT NULL,evidence_id TEXT NOT NULL,data BLOB NOT NULL,CHECK(typeof(data)='blob' AND length(data) BETWEEN 1 AND 524288),PRIMARY KEY(challenge_id,evidence_id),FOREIGN KEY(challenge_id) REFERENCES challenges(id))"
SERVER = '''import sys,signal,threading
from pathlib import Path
from challenges.server import create_server
server=create_server(Path(sys.argv[1]),port=0)
print(server.server_address[1],flush=True)
signal.signal(signal.SIGTERM,lambda *_:threading.Thread(target=server.shutdown,daemon=True).start())
try:server.serve_forever(poll_interval=.05)
finally:server.server_close()
'''


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_private(path, data):
    if not isinstance(data, bytes):
        data = json.dumps(data, ensure_ascii=False, indent=2).encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)


def event(state, actor, kind, details, at):
    state['revision'] += 1
    state['events'].append(dict(seq=state['revision'], at=at, actor=actor,
                                kind=kind, details=deepcopy(details)))


def original_jpeg(index, maximum):
    color = ((index * 31 + 30) % 256, (index * 47 + 90) % 256,
             (index * 17 + 170) % 256)
    stream = io.BytesIO()
    Image.new('RGB', (37, 23), color).save(stream, 'JPEG', quality=90)
    data = stream.getvalue()
    if maximum:
        data = data[:-2] + b'\xff' * (524288 - len(data)) + data[-2:]
    with Image.open(io.BytesIO(data)) as decoded:
        decoded.load()
        assert decoded.mode == 'RGB' and decoded.size == (37, 23)
        assert max(abs(a - b) for a, b in zip(decoded.getpixel((18, 11)), color)) <= 3
    return data


def ledger(index, image_count=0, maximum=False, pending=False, disputed=False, resolved=False):
    identifier = f'{index:032x}'
    # Random private values, never deterministic credentials in a published fixture.
    seats = {key: secrets.token_hex(32) for key in
             ('proposer', 'opponent', 'arbiter', 'opponentInvite', 'arbiterInvite', 'withdrawnInvite')}
    terms = dict(title=f'Original café study {index} — <not markup>',
                 description='A literal shared record, not an inferred agreement.',
                 successCriteria='Supply the original panel before the agreed deadline.',
                 evidenceRule='Retain the supplied image and literal caption.\nLate evidence stays late.',
                 stake='pick-a-movie', deadline=DEADLINE)
    state = dict(id=identifier, revision=0, status='proposed', termsVersion=1,
                 terms=terms, acceptedAt=None, createdAt=CREATED,
                 profiles=dict(proposer=dict(name='Alex'), opponent=None, arbiter=None),
                 evidence=[], events=[], resultProposal=None, voidProposal=None,
                 arbiterNomination=None, resolution=None,
                 limitsUsed=dict(termsEdits=0, resultProposals=0, arbiterNominations=0,
                                 opponentInvites=1, arbiterInvites=0))
    event(state, 'proposer', 'created', dict(name='Alex', terms=terms, termsVersion=1), CREATED)
    hashes = dict(proposer=sha(seats['proposer'].encode()), opponent=None, arbiter=None,
                  opponentInvite=sha(seats['opponentInvite'].encode()), arbiterInvite=None)
    if not pending:
        state['profiles']['opponent'] = dict(name='Sam')
        hashes['opponent'] = sha(seats['opponent'].encode())
        hashes['opponentInvite'] = None
        event(state, 'opponent', 'opponent_joined', dict(name='Sam'), CREATED + 1000)
        state['status'], state['acceptedAt'] = 'active', CREATED + 2000
        event(state, 'opponent', 'accepted', dict(termsVersion=1), CREATED + 2000)
    images = []
    for position in range(image_count):
        jpeg = original_jpeg(index * 8 + position, maximum)
        at = CREATED + 3000 + position if position % 2 == 0 else DEADLINE + position
        item = dict(id=f'{index * 100 + position + 1:032x}', author='proposer' if position % 2 == 0 else 'opponent',
                    text=f'Panel {position + 1}: <script>literal only</script> café 🖼\r\nOriginal bytes.',
                    url=None, createdAt=at, late=at >= DEADLINE,
                    image=dict(mime='image/jpeg', bytes=len(jpeg), width=37, height=23, sha256=sha(jpeg)))
        state['evidence'].append(item)
        event(state, item['author'], 'evidence_image_added', dict(evidence=item), at)
        images.append((item['id'], jpeg))
    if disputed or resolved:
        at = DEADLINE + 1000
        proposal = dict(id=f'{index * 100 + 50:032x}', proposedBy='proposer', outcome='proposer',
                        reason='The supplied panel is complete.', status='pending', createdAt=at, respondedAt=None)
        state['resultProposal'] = proposal
        state['limitsUsed']['resultProposals'] = 1
        event(state, 'proposer', 'result_proposed', dict(proposal=proposal), at)
        proposal.update(status='rejected', respondedAt=at + 1000)
        state['status'] = 'disputed'
        event(state, 'opponent', 'result_responded', dict(proposalId=proposal['id'], accept=False,
                                                         reason='Please obtain the agreed independent decision.'), at + 1000)
        # Two nominations prove a withdrawn invitation cannot revive on restoration.
        for number in range(2):
            at += 10000
            nomination = dict(id=f'{index * 100 + 60 + number:032x}', name='Taylor', proposedBy='proposer',
                              reason='Review our literal supplied record.', status='pending', createdAt=at, respondedAt=None)
            state['arbiterNomination'] = nomination
            state['limitsUsed']['arbiterNominations'] += 1
            event(state, 'proposer', 'arbiter_nominated', dict(nomination=nomination), at)
            nomination.update(status='approved', respondedAt=at + 1000)
            event(state, 'opponent', 'arbiter_responded', dict(nominationId=nomination['id'], accept=True, reason=''), at + 1000)
            state['limitsUsed']['arbiterInvites'] += 1
            event(state, 'proposer', 'invite_issued', dict(seat='arbiter'), at + 2000)
            if number == 0:
                nomination.update(status='withdrawn', respondedAt=at + 3000)
                event(state, 'proposer', 'arbiter_withdrawn', dict(nominationId=nomination['id'], reason='Use a fresh mutually approved appointment.'), at + 3000)
        hashes['arbiterInvite'] = sha(seats['arbiterInvite'].encode())
        if resolved:
            state['profiles']['arbiter'] = dict(name='Taylor')
            hashes['arbiter'] = sha(seats['arbiter'].encode())
            hashes['arbiterInvite'] = None
            event(state, 'arbiter', 'arbiter_joined', dict(nominationId=nomination['id'], name='Taylor'), at + 4000)
            state['status'] = 'resolved'
            state['resultProposal'] = None
            state['resolution'] = dict(outcome='opponent', method='arbiter', by='arbiter',
                                       reason='Literal retained evidence supports the opponent.', decidedAt=at + 5000, proposalId=None)
            event(state, 'arbiter', 'arbiter_decided', dict(outcome='opponent', reason=state['resolution']['reason']), at + 5000)
    record = dict(schemaVersion=2 if images else 1, state=state, hashes=hashes)
    return record, seats, images


def fingerprints(directory):
    with sqlite3.connect(f'file:{directory / "challenges.sqlite3"}?mode=ro', uri=True) as db:
        records = {identifier: sha(raw.encode()) for identifier, raw in db.execute('SELECT id,record FROM challenges ORDER BY id')}
        images = {f'{challenge}/{evidence}': sha(data) for challenge, evidence, data in db.execute('SELECT challenge_id,evidence_id,data FROM evidence_images ORDER BY challenge_id,evidence_id')}
    return dict(records=records, images=images)


def fixtures(output, profile):
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = output / 'source'
    source.mkdir(mode=0o700)
    write_private(source / '.server.lock', b'')
    specs = [(n, 8, True, False, False, False) for n in range(1, 21)] if profile == 'maximum' else [
        (1, 2, False, False, False, True), (2, 0, False, True, False, False), (3, 0, False, False, True, False)]
    private, originals, rows = [], [], []
    for args in specs:
        record, seats, images = ledger(*args)
        # Deliberately noncanonical TEXT: alternate order, indents, leading/trailing whitespace.
        if args[0] % 2:
            record = dict(reversed(list(record.items())))
        raw = ' \n' + json.dumps(record, ensure_ascii=False, indent=1 if args[0] % 2 else 3) + '\n\t'
        originals.append((record['state']['id'], raw))
        rows.extend((record['state']['id'], evidence, data) for evidence, data in images)
        private.append(dict(id=record['state']['id'], seats=seats, record=record))
    dbpath = source / 'challenges.sqlite3'
    with sqlite3.connect(dbpath) as db:
        db.execute(CHALLENGES_SQL)
        db.execute(IMAGES_SQL)
        db.execute('PRAGMA user_version=2')
        db.executemany('INSERT INTO challenges VALUES (?,?)', originals)
        db.executemany('INSERT INTO evidence_images VALUES (?,?,?)', rows)
    dbpath.chmod(0o600)
    write_private(output / 'private-fixture.json', private)
    expected = dict(profile=profile, challenges=len(specs), imageCount=len(rows),
                    mediaBytes=sum(len(row[2]) for row in rows),
                    sourceDatabaseSha256=sha(dbpath.read_bytes()),
                    sourceDatabaseBytes=dbpath.stat().st_size,
                    **fingerprints(source),
                    limits='Exact image count/bytes are exercised; no exact raw-record or database byte ceiling claim.')
    write_private(output / 'frozen-expectations.json', expected)
    return expected


class Service:
    def __init__(self, directory):
        self.process = subprocess.Popen([sys.executable, '-c', SERVER, str(directory)], cwd=APP,
                                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        import select
        ready, _, _ = select.select([self.process.stdout], [], [], 15)
        if not ready:
            self.close()
            raise RuntimeError('Service did not become ready within the bounded startup interval.')
        port = self.process.stdout.readline().strip()
        if not port.isdigit():
            self.close()
            raise RuntimeError('Service startup failed; no private diagnostics were retained.')
        self.origin = f'http://127.0.0.1:{port}'

    def close(self):
        if self.process.poll() is None:
            self.process.send_signal(signal.SIGTERM)
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)


def request(origin, path, token, body=None):
    headers = {'Authorization': f'Bearer {token}'}
    if body is not None:
        headers['Content-Type'] = 'application/json'
        headers['Origin'] = origin
        body = json.dumps(body).encode()
    req = urllib.request.Request(origin + path, body, headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def verify_http(service, private, output=None, phase=None):
    results = []
    for fixture in private:
        identifier, seats, record = fixture['id'], fixture['seats'], fixture['record']
        public = dict(deepcopy(record['state']), deadlinePassed=True)
        for role in ('proposer', 'opponent', 'arbiter'):
            if record['state']['profiles'][role] is None:
                continue
            status, data = request(service.origin, f'/api/challenges/{identifier}', seats[role])
            assert status == 200, 'Original claimed seat failed after restored service startup.'
            actual = json.loads(data)
            assert actual.pop('myRole') == role
            assert isinstance(actual.pop('serverTime'), int)
            assert actual == public, 'Original seat snapshot differs from the authored ledger.'
        status, data = request(service.origin, f'/api/challenges/{identifier}/export', seats['proposer'])
        assert status == 200
        exported = json.loads(data)
        assert isinstance(exported.pop('exportedAt'), int)
        assert exported == dict(schemaVersion=record['schemaVersion'], challenge=public)
        status, report = request(service.origin, f'/api/challenges/{identifier}/export/images', seats['proposer'])
        assert status == 200
        text = report.decode()
        embedded = re.findall(r'data:image/jpeg;base64,([A-Za-z0-9+/=]+)', text)
        image_entries = [item for item in public['evidence'] if 'image' in item]
        assert len(embedded) == len(image_entries)
        for item, encoded in zip(image_entries, embedded):
            status, jpeg = request(service.origin, f'/api/challenges/{identifier}/evidence/{item["id"]}/image', seats['proposer'])
            assert status == 200 and sha(jpeg) == item['image']['sha256']
            assert base64.b64decode(encoded, validate=True) == jpeg
        match = re.search(r'<pre[^>]*>(.*?)</pre>', text, re.S)
        assert match, 'Complete literal public JSON is missing from the image report.'
        report_record = json.loads(html.unescape(match[1]))
        report_record.pop('exportedAt')
        assert report_record == exported
        assert '<script>literal only</script>' not in text
        assert all(token.encode() not in report and token.encode() not in data for token in seats.values())
        if output is not None and not results:
            write_private(output / f'{phase}-first-public.json', data)
            write_private(output / f'{phase}-first-complete.html', report)
        results.append(dict(id=identifier, imageCount=len(image_entries), htmlBytes=len(report), htmlSha256=sha(report)))
    return results


def cli(args, private):
    started = time.monotonic()
    run = subprocess.run([sys.executable, '-m', 'challenges.backup', *args], cwd=APP,
                         capture_output=True, timeout=320)
    output = run.stdout + run.stderr
    # A failing producer must not cause this independent harness to publish secrets.
    assert all(token.encode() not in output for item in private for token in item['seats'].values()), 'CLI disclosed a raw capability.'
    assert all(digest.encode() not in output for item in private for digest in item['record']['hashes'].values() if digest), 'CLI disclosed a private digest.'
    assert run.returncode == 0, f'Archive CLI {args[0]} failed with exit {run.returncode}; output is withheld.'
    return dict(action=args[0], seconds=time.monotonic() - started, stdoutBytes=len(run.stdout), stderrBytes=len(run.stderr), outputSha256=sha(output))


def run(output):
    expected = json.loads((output / 'frozen-expectations.json').read_text())
    private = json.loads((output / 'private-fixture.json').read_text())
    source, restored, archive = output / 'source', output / 'restored', output / 'library.zip'
    services, receipts = [], []
    started = time.monotonic()
    try:
        original = Service(source)
        services.append(original)
        source_results = verify_http(original, private, output, 'source')
        original.close()
        before = sha((source / 'challenges.sqlite3').read_bytes())
        assert before == expected['sourceDatabaseSha256'], 'Read-only source access rewrote the raw fixture database.'
        receipts.append(cli(['create', '--data-dir', str(source), '--output', str(archive)], private))
        receipts.append(cli(['inspect', '--archive', str(archive)], private))
        assert sha((source / 'challenges.sqlite3').read_bytes()) == before
        assert fingerprints(source) == {key: expected[key] for key in ('records', 'images')}
        # Independent standard-library read, never producer extraction or expected encoding.
        with zipfile.ZipFile(archive) as container:
            names = container.namelist()
            assert names[0] == 'manifest.json'
            for identifier, raw_hash in expected['records'].items():
                assert sha(container.read(f'records/{identifier}.json')) == raw_hash
            for pair, image_hash in expected['images'].items():
                assert sha(container.read(f'images/{pair}.jpg')) == image_hash
            assert len(names) == 1 + expected['challenges'] + len(expected['images'])
        receipts.append(cli(['restore', '--archive', str(archive), '--data-dir', str(restored)], private))
        assert fingerprints(restored) == fingerprints(source)
        restored_service = Service(restored)
        services.append(restored_service)
        restored_results = verify_http(restored_service, private, output, 'restored')
        restored_service.close()
        restarted = Service(restored)
        services.append(restarted)
        restart_results = verify_http(restarted, private, output, 'restart')
        restarted.close()
        assert fingerprints(restored) == fingerprints(source)
        result = dict(status='passed', profile=expected['profile'], challengeCount=expected['challenges'],
                      imageCount=len(expected['images']), mediaBytes=expected['mediaBytes'],
                      archiveBytes=archive.stat().st_size, archiveSha256=sha(archive.read_bytes()),
                      sourceDatabaseUnchanged=True, rawRecordAndJpegHashesPreserved=True,
                      independentServicePids=[item.process.pid for item in services],
                      allServicesStopped=all(item.process.poll() is not None for item in services),
                      cli=receipts, source=source_results, restored=restored_results, restart=restart_results,
                      wallSeconds=time.monotonic() - started,
                      limitations='Actual CLI and HTTP, no browser in this script. exportedAt and serverTime are live clocks; public payloads otherwise match literal expected states. Not an RSS or arbitrary same-UID security test.')
        write_private(output / 'verification.json', result)
        return result
    finally:
        for service in services:
            service.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--profile', choices=('browser', 'maximum'), default='maximum')
    parser.add_argument('--fixtures-only', action='store_true')
    parser.add_argument('--run-existing', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    if not args.run_existing:
        fixtures(args.output, args.profile)
    if args.fixtures_only:
        print(json.dumps(dict(status='fixtures-frozen', profile=args.profile)))
    else:
        result = run(args.output)
        print(json.dumps({key: result[key] for key in ('status', 'challengeCount', 'imageCount', 'mediaBytes', 'archiveBytes', 'wallSeconds')}))


if __name__ == '__main__':
    main()
