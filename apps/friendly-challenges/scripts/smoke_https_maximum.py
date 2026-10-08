"""Independent manual HTTPS capacity acceptance with original padded JPEGs.

Prepare: python scripts/smoke_https_maximum.py --output NEW_DIRECTORY --fixtures-only
Run after a coherent production build/runtime release:
  python scripts/smoke_https_maximum.py --output THAT_DIRECTORY --run-prepared

Only its own new library/services are used. Original fixture expectations are
frozen before transport execution. No production transport/render helper is an
oracle. Legal marker-fill padding reaches byte limits; this is not complex-photo
or peak-RAM evidence. Runtime requires Pillow, OpenSSL and the built app.
"""
import argparse
import base64
import hashlib
from html.parser import HTMLParser
from io import BytesIO
import json
import os
from pathlib import Path
import secrets
import selectors
import signal
import socket
import sqlite3
import ssl
import subprocess
import sys
import tempfile
import time
import http.client

import PIL
from PIL import Image

APP = Path(__file__).resolve().parents[1]
CAP = 512 * 1024
ROOMS = 20
IMAGES = 160
FIXTURE_MS = 1767225600000  # 2026-01-01, explicitly fixed historical fixture clock
DEADLINE = FIXTURE_MS + 365 * 86400000
ROLES = ('proposer', 'opponent', 'arbiter')
EVENT_KINDS = ['created', 'opponent_joined', 'accepted'] + ['evidence_image_added'] * 8 + [
    'result_proposed', 'result_responded', 'arbiter_nominated', 'arbiter_responded',
    'invite_issued', 'arbiter_joined', 'arbiter_decided',
]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()


def private_write(path, data):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(data)


def color(index):
    return 32 + index % 16 * 13, 48 + index // 16 * 17, 180 - index * 7 % 100


def jpeg(index):
    source = BytesIO()
    rgb = color(index)
    Image.new('RGB', (48, 32), rgb).save(source, 'JPEG', quality=92, subsampling=0)
    original = source.getvalue()
    assert original[:2] == b'\xff\xd8' and original[-2:] == b'\xff\xd9'
    data = original[:-2] + b'\xff' * (CAP - len(original)) + original[-2:]
    assert len(data) == CAP
    verify_pixels(data, rgb)
    return data


def verify_pixels(data, rgb):
    with Image.open(BytesIO(data)) as decoded:
        decoded.load()
        assert decoded.format == 'JPEG' and decoded.mode == 'RGB' and decoded.size == (48, 32)
        for point in ((3, 3), (24, 16), (44, 28)):
            assert max(abs(a - b) for a, b in zip(decoded.getpixel(point), rgb)) <= 2


def private_rows(directory):
    database = directory / 'challenges.sqlite3'
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as connection:
        records = connection.execute('SELECT id,record FROM challenges ORDER BY id').fetchall()
        count, size = connection.execute('SELECT count(*),sum(length(data)) FROM evidence_images').fetchone()
        assert (count, size) == (IMAGES, IMAGES * CAP)
        return records


def assert_literal_state(state, number, manifest_images):
    assert state['status'] == 'resolved' and state['revision'] == 18
    assert state['termsVersion'] == 1 and state['terms']['title'] == f'HTTPS capacity challenge {number + 1:02d}'
    assert state['terms']['stake'] == 'bragging-rights' and state['terms']['deadline'] == DEADLINE
    assert state['profiles'] == {role: {'name': f'{role.title()} {number + 1:02d}'} for role in ROLES}
    assert state['resolution']['method'] == 'arbiter' and state['resolution']['by'] == 'arbiter'
    assert state['resolution']['outcome'] == ('proposer' if number % 2 == 0 else 'opponent')
    assert [event['kind'] for event in state['events']] == EVENT_KINDS
    assert [event['seq'] for event in state['events']] == list(range(1, 19))
    assert len(state['evidence']) == 8
    for offset, (entry, expected) in enumerate(zip(state['evidence'], manifest_images)):
        assert entry['author'] == ('proposer' if offset % 2 == 0 else 'opponent')
        assert entry['text'] == f'Original supplied image {number + 1:02d}/{offset + 1}: unverified capacity fixture'
        assert entry['url'] is None and entry['late'] is False
        assert entry['image'] == {key: expected[key] for key in ('mime', 'bytes', 'width', 'height', 'sha256')}


def certificates(directory):
    directory.mkdir(mode=0o700)
    extension = directory / 'leaf.ext'
    extension.write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n')
    commands = [
        ['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '30',
         '-subj', '/CN=Friendly HTTPS Capacity Fixture CA', '-keyout', 'ca.key', '-out', 'ca.pem',
         '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'],
        ['openssl', 'req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
         '-subj', '/CN=localhost', '-keyout', 'server.key', '-out', 'server.csr'],
        ['openssl', 'x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key',
         '-CAcreateserial', '-days', '30', '-sha256', '-extfile', 'leaf.ext', '-out', 'server.pem'],
    ]
    for command in commands:
        subprocess.run(command, cwd=directory, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       check=True, timeout=30)
    for filename in ('ca.key', 'server.key'):
        (directory / filename).chmod(0o600)
    private_write(directory / 'setup.key', secrets.token_hex(32).encode() + b'\n')


def prepare(output):
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    (output / 'images').mkdir()
    (output / 'private').mkdir(mode=0o700)
    certificates(output / 'tls')
    sys.path.insert(0, str(APP))
    # Existing unchanged authoritative API seeds a new library only. Expected
    # image patterns, event sequence, roles and decisions above are independent.
    from challenges.store import Store
    fixture = {'schemaVersion': 1, 'generator': {'scriptSha256': digest(Path(__file__).read_bytes()),
               'pillowVersion': PIL.__version__, 'fixedClockMs': FIXTURE_MS},
               'scope': '20 original three-seat resolved records, 160 distinct simple RGB JPEGs with legal marker-fill padding; no complex-photo/RSS claim.',
               'jpegBytes': CAP, 'challenges': []}
    seats = []
    clock = [FIXTURE_MS]
    store = Store(output / 'data', clock=lambda: clock[0] / 1000)
    started = time.monotonic()
    try:
        for number in range(ROOMS):
            terms = {'title': f'HTTPS capacity challenge {number + 1:02d}',
                     'description': 'Original private HTTPS capacity record',
                     'successCriteria': 'Inspect all exact retained supplied copies',
                     'evidenceRule': 'Original fixture images are unverified claims',
                     'stake': 'bragging-rights', 'deadline': DEADLINE}
            created = store.create({'name': f'Proposer {number + 1:02d}', 'terms': terms})
            challenge_id = created['challengeId']
            joined = store.join(challenge_id, {'name': f'Opponent {number + 1:02d}', 'inviteToken': created['inviteToken']})
            credentials = {'proposer': created['token'], 'opponent': joined['token']}
            snapshot = store.command(challenge_id, credentials['opponent'], 'accept',
                                     {'revision': joined['challenge']['revision'], 'termsVersion': 1})
            items = []
            for offset in range(8):
                index = number * 8 + offset
                data = jpeg(index)
                filename = f'image-{index:03d}.jpg'
                (output / 'images' / filename).write_bytes(data)
                expected = {'filename': filename, 'rgb': list(color(index)), 'mime': 'image/jpeg',
                            'bytes': CAP, 'width': 48, 'height': 32, 'sha256': digest(data)}
                clock[0] += 1000
                snapshot = store.add_image(challenge_id, credentials['proposer' if offset % 2 == 0 else 'opponent'],
                                          {'revision': snapshot['revision'],
                                           'text': f'Original supplied image {number + 1:02d}/{offset + 1}: unverified capacity fixture',
                                           'url': None}, data)
                expected['evidenceId'] = snapshot['evidence'][-1]['id']
                items.append(expected)
            def command(role, action, **fields):
                nonlocal snapshot
                clock[0] += 1000
                snapshot = store.command(challenge_id, credentials[role], action,
                                         {'revision': snapshot['revision'], **fields})
                return snapshot
            command('proposer', 'result', outcome='proposer', reason='Explicit original proposal')
            command('opponent', 'result/respond', proposalId=snapshot['resultProposal']['id'],
                    accept=False, reason='Explicit original dispute')
            command('proposer', 'arbiter/nominate', name=f'Arbiter {number + 1:02d}', reason='Review the supplied fixture copies')
            command('opponent', 'arbiter/respond', nominationId=snapshot['arbiterNomination']['id'], accept=True, reason='')
            invitation = store.command(challenge_id, credentials['proposer'], 'invite',
                                       {'revision': snapshot['revision'], 'seat': 'arbiter'})
            snapshot = invitation['challenge']
            arbiter = store.join_arbiter(challenge_id, {'name': f'Arbiter {number + 1:02d}',
                                                     'inviteToken': invitation['inviteToken']})
            credentials['arbiter'] = arbiter['token']
            snapshot = arbiter['challenge']
            command('arbiter', 'arbiter/decide', outcome='proposer' if number % 2 == 0 else 'opponent',
                    reason='Explicit original capacity-fixture decision, not verified real-world evidence')
            state = {key: value for key, value in snapshot.items() if key not in ('myRole', 'serverTime', 'deadlinePassed')}
            assert_literal_state(state, number, items)
            fixture['challenges'].append({'id': challenge_id, 'state': state, 'images': items})
            seats.append({'id': challenge_id, 'tokens': credentials, 'usedOpponentInvite': created['inviteToken'],
                          'usedArbiterInvite': invitation['inviteToken']})
            print(f'Prepared {number + 1}/20 original records; {(number + 1) * 8}/160 images.', flush=True)
    finally:
        store.close()
    rows = private_rows(output / 'data')
    private_write(output / 'private' / 'records.json', json_bytes(rows))
    private_write(output / 'private' / 'seats.json', json_bytes(seats))
    fixture['privateRecordSha256'] = {key: digest(raw.encode()) for key, raw in rows}
    assert len({item['sha256'] for challenge in fixture['challenges'] for item in challenge['images']}) == IMAGES
    fixture['preparationSeconds'] = round(time.monotonic() - started, 3)
    (output / 'fixtures.json').write_bytes(json_bytes(fixture))
    print('Original expectations frozen; HTTPS execution has not started.', flush=True)


class HtmlRecord(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_pre = False
        self.parts = []
        self.records = []
        self.image_data = []
        self.scripts = 0

    def handle_starttag(self, tag, attrs):
        if tag == 'pre':
            assert not self.in_pre
            self.in_pre, self.parts = True, []
        if tag == 'script':
            self.scripts += 1
        if tag == 'img':
            attrs = dict(attrs)
            prefix = 'data:image/jpeg;base64,'
            assert attrs.get('src', '').startswith(prefix)
            self.image_data.append(base64.b64decode(attrs['src'][len(prefix):], validate=True))

    def handle_data(self, value):
        if self.in_pre:
            self.parts.append(value)

    def handle_endtag(self, tag):
        if tag == 'pre' and self.in_pre:
            self.records.append(json.loads(''.join(self.parts)))
            self.in_pre = False


def reserve_port():
    with socket.socket() as candidate:
        candidate.bind(('127.0.0.1', 0))
        return candidate.getsockname()[1]


def start(output, port, phase):
    origin = f'https://localhost:{port}'
    tls = output / 'tls'
    log = os.open(output / 'private' / f'{phase}-stderr.log', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    command = [sys.executable, '-u', '-m', 'challenges', '--data-dir', str(output / 'data'),
               '--port', str(port), '--bind', '127.0.0.1', '--origin', origin,
               '--tls-cert', str(tls / 'server.pem'), '--tls-key', str(tls / 'server.key'),
               '--setup-token-file', str(tls / 'setup.key')]
    try:
        process = subprocess.Popen(command, cwd=APP, stdout=subprocess.PIPE, stderr=log, text=True)
    finally:
        os.close(log)
    selector = selectors.DefaultSelector()
    try:
        selector.register(process.stdout, selectors.EVENT_READ)
        if not selector.select(60):
            raise RuntimeError('Owned HTTPS service startup timed out.')
        line = process.stdout.readline(1024)
        if line.strip() != f'Friendly Challenges: {origin}':
            raise RuntimeError('Owned HTTPS service failed startup; inspect its private stderr file.')
    except BaseException:
        stop(process)
        raise
    finally:
        selector.close()
    return process


def stop(process):
    if process is None:
        return
    if process.poll() is None:
        process.send_signal(signal.SIGTERM)
        try:
            process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
            raise RuntimeError('Owned HTTPS service required forced cleanup.') from None
    assert process.returncode == 0, 'Owned HTTPS service did not close cleanly.'
    process.stdout.close()


def request(context, port, path, *, token=None, headers=None, method='GET', payload=None, expected=200, maximum=12 * 1024 * 1024):
    values = dict(headers or {})
    if token:
        values['Authorization'] = 'Bearer ' + token
    if payload is not None:
        payload = json_bytes(payload)
        values['Content-Type'] = 'application/json'
        values['Origin'] = f'https://localhost:{port}'
    connection = http.client.HTTPSConnection('localhost', port, context=context, timeout=35)
    try:
        connection.connect()
        version = connection.sock.version()
        certificate = connection.sock.getpeercert()
        assert version in ('TLSv1.2', 'TLSv1.3')
        assert ('DNS', 'localhost') in certificate['subjectAltName']
        connection.request(method, path, body=payload, headers=values)
        response = connection.getresponse()
        assert response.status == expected, f'Unexpected HTTPS status {response.status}; expected {expected}.'
        length = response.getheader('Content-Length')
        assert length is not None and length.isdecimal() and int(length) <= maximum
        raw = response.read(maximum + 1)
        assert len(raw) == int(length) <= maximum
        assert response.getheader('Cache-Control') == 'no-store'
        assert response.getheader('Referrer-Policy') == 'no-referrer'
        content_type = response.getheader('Content-Type', '')
        value = json.loads(raw) if content_type.startswith('application/json') else raw
        return value, content_type, version
    finally:
        connection.close()


def public_expected(challenge, server_time):
    return {**challenge['state'], 'deadlinePassed': server_time >= DEADLINE}


def verify_phase(output, fixture, seats, context, port, phase):
    reports = []
    (output / phase).mkdir()
    image_reads = 0
    versions = set()
    private_values = [value for seat in seats for value in seat['tokens'].values()]
    private_values += [seat[key] for seat in seats for key in ('usedOpponentInvite', 'usedArbiterInvite')]
    private_values.append((output / 'tls' / 'setup.key').read_text().strip())
    for number, (challenge, seat) in enumerate(zip(fixture['challenges'], seats)):
        path = '/api/challenges/' + challenge['id']
        assert challenge['id'] == seat['id']
        assert_literal_state(challenge['state'], number, challenge['images'])
        for role in ROLES:
            snapshot, mime, version = request(context, port, path, token=seat['tokens'][role], maximum=1024 * 1024)
            versions.add(version)
            assert mime.startswith('application/json') and snapshot['myRole'] == role
            assert {key: value for key, value in snapshot.items() if key not in ('myRole', 'serverTime')} == public_expected(challenge, snapshot['serverTime'])
            for item in challenge['images']:
                data, mime, _ = request(context, port, path + '/evidence/' + item['evidenceId'] + '/image', token=seat['tokens'][role], maximum=CAP)
                assert mime == 'image/jpeg' and len(data) == CAP and digest(data) == item['sha256']
                assert data == (output / 'images' / item['filename']).read_bytes()
                image_reads += 1
        report, mime, _ = request(context, port, path + '/export/images', token=seat['tokens']['opponent'])
        assert mime == 'text/html; charset=utf-8' and isinstance(report, bytes)
        parsed = HtmlRecord()
        parsed.feed(report.decode('utf-8'))
        parsed.close()
        assert parsed.scripts == 0 and len(parsed.records) == 1 and len(parsed.image_data) == 8
        public = parsed.records[0]
        assert public['schemaVersion'] == 2 and public['challenge'] == public_expected(challenge, public['exportedAt'])
        exported, _, _ = request(context, port, path + '/export', token=seat['tokens']['proposer'], maximum=1024 * 1024)
        assert exported['schemaVersion'] == 2 and exported['challenge'] == public_expected(challenge, exported['exportedAt'])
        for data, item in zip(parsed.image_data, challenge['images']):
            assert data == (output / 'images' / item['filename']).read_bytes()
            assert digest(data) == item['sha256']
            verify_pixels(data, item['rgb'])
        assert all(value.encode() not in report for value in private_values)
        assert not any(key in public for key in ('hashes', 'token', 'inviteToken'))
        filename = f'challenge-{number + 1:02d}.html'
        (output / phase / filename).write_bytes(report)
        reports.append({'filename': phase + '/' + filename, 'bytes': len(report), 'sha256': digest(report),
                        'embeddedImages': 8, 'exactSourceBytes': True, 'completePublicAudit': True})
        print(f'{phase}: verified {number + 1}/20 records, {image_reads}/480 authorized image reads.', flush=True)
    first = fixture['challenges'][0]
    path = '/api/challenges/' + first['id']
    image = path + '/evidence/' + first['images'][0]['evidenceId'] + '/image'
    for headers in ({}, {'Cookie': 'seat=' + seats[0]['tokens']['proposer']},
                    {'X-Friendly-Setup-Key': private_values[-1]}):
        value, _, _ = request(context, port, image, headers=headers, expected=401, maximum=1024 * 1024)
        assert value['code'] == 'unauthorized'
    request(context, port, image, token=seats[1]['tokens']['proposer'], expected=401, maximum=1024 * 1024)
    for suffix, key, name in (('/join', 'usedOpponentInvite', 'Opponent 01'),
                              ('/arbiter/join', 'usedArbiterInvite', 'Arbiter 01')):
        value, _, _ = request(context, port, path + suffix, method='POST',
                              payload={'inviteToken': seats[0][key], 'name': name}, expected=404, maximum=1024 * 1024)
        assert value['code'] == 'not_found'
    value, _, _ = request(context, port, '/api/challenges', method='POST', payload={}, expected=403, maximum=1024 * 1024)
    assert value['code'] == 'forbidden'
    return {'records': ROOMS, 'originalAuthenticatedRolesPerRecord': list(ROLES),
            'exactImageReads': image_reads, 'reports': reports, 'tlsVersions': sorted(versions),
            'absentCookieSetupAndForeignSeatDenied': True, 'usedInvitesStillUnavailable': True}


def run_prepared(output):
    fixture_bytes = (output / 'fixtures.json').read_bytes()
    fixture = json.loads(fixture_bytes)
    seats = json.loads((output / 'private' / 'seats.json').read_bytes())
    expected_rows = [tuple(item) for item in json.loads((output / 'private' / 'records.json').read_bytes())]
    assert private_rows(output / 'data') == expected_rows
    assert len(fixture['challenges']) == ROOMS and len(seats) == ROOMS
    for challenge in fixture['challenges']:
        for item in challenge['images']:
            assert digest((output / 'images' / item['filename']).read_bytes()) == item['sha256']
    context = ssl.create_default_context(cafile=str(output / 'tls' / 'ca.pem'))
    assert context.check_hostname and context.verify_mode == ssl.CERT_REQUIRED
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    port = reserve_port()
    receipt = {'schemaVersion': 1, 'status': 'running', 'fixtureSha256': digest(fixture_bytes),
               'scope': fixture['scope'], 'records': ROOMS, 'uniqueImages': IMAGES,
               'retainedImageBytes': IMAGES * CAP, 'strictCaAndHostnameVerification': True,
               'browserOrPhysicalDeviceClaim': False, 'pythonVersion': sys.version.split()[0],
               'pillowVersion': PIL.__version__, 'opensslVersion': ssl.OPENSSL_VERSION,
               'scriptSha256': digest(Path(__file__).read_bytes()),
               'certificateSha256': digest((output / 'tls' / 'server.pem').read_bytes()),
               'sourceSha256': {name: digest((APP / name).read_bytes()) for name in (
                   'challenges/transport.py', 'challenges/https_server.py', 'challenges/server.py',
                   'challenges/__main__.py', 'challenges/store.py', 'challenges/images.py',
                   'challenges/image_export.py')}, 'port': port}
    process = None
    started = time.monotonic()
    try:
        process = start(output, port, 'before-restart')
        receipt['originalPid'] = process.pid
        status, _, _ = request(context, port, '/api/status', maximum=1024 * 1024)
        assert status['transport'] == {'mode': 'https-lan', 'origin': f'https://localhost:{port}', 'setupRequired': True}
        receipt['beforeRestart'] = verify_phase(output, fixture, seats, context, port, 'before-restart')
        stop(process)
        process = None
        assert private_rows(output / 'data') == expected_rows
        process = start(output, port, 'after-restart')
        receipt['restartedPid'] = process.pid
        assert process.pid != receipt['originalPid']
        receipt['afterRestart'] = verify_phase(output, fixture, seats, context, port, 'after-restart')
        stop(process)
        process = None
        assert private_rows(output / 'data') == expected_rows
        receipt.update(status='passed', allOriginalPrivateRecordTextUnchanged=True,
                       allOriginalCapabilitiesRetained=True, samePortFreshProcess=True,
                       originalPrivateRecordSha256=fixture['privateRecordSha256'],
                       durationSeconds=round(time.monotonic() - started, 3))
        print(f'PASS: 20 records, 160 unique JPEGs, 960 exact authorized image reads, 40 complete HTML exports; {receipt["durationSeconds"]} seconds.', flush=True)
    except BaseException as error:
        receipt['status'] = 'failed'
        receipt['failureType'] = type(error).__name__
        receipt['durationSeconds'] = round(time.monotonic() - started, 3)
        raise
    finally:
        try:
            stop(process)
        finally:
            (output / 'verification.json').write_bytes(json_bytes(receipt))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--fixtures-only', action='store_true')
    mode.add_argument('--run-prepared', action='store_true')
    args = parser.parse_args()
    if args.run_prepared and args.output is None:
        parser.error('--run-prepared requires an explicit previously prepared output directory.')
    if args.output is None:
        output = Path(tempfile.mkdtemp(prefix='friendly-https-maximum-'))
        output.rmdir()  # prepare alone owns creation and refuses an existing directory
    else:
        output = args.output.absolute()
    if args.run_prepared:
        if (output / 'verification.json').exists():
            parser.error('This fixture has already been attempted; preserve it and prepare a new output directory.')
    else:
        prepare(output)
    if not args.fixtures_only:
        run_prepared(output)


if __name__ == '__main__':
    main()
