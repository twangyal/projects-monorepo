"""Manual real-HTTP maximum image capacity and service-process restart acceptance.

Uses independently generated valid JPEGs padded with legal marker fill, not
high-detail 512 KiB photographs. No production validator is used as an oracle.
Requires the app's built dist and runtime Pillow. Writes only to a new output dir.
"""
import argparse
import base64
import hashlib
from html.parser import HTMLParser
import http.client
from io import BytesIO
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
import time

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CAP = 512 * 1024


class PublicRecord(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.inside = False
        self.value = ''
        self.records = []

    def handle_starttag(self, tag, attrs):
        if tag == 'pre':
            self.inside, self.value = True, ''

    def handle_endtag(self, tag):
        if tag == 'pre' and self.inside:
            self.records.append(json.loads(self.value))
            self.inside = False

    def handle_data(self, value):
        if self.inside:
            self.value += value


def digest(data):
    return hashlib.sha256(data).hexdigest()


def generate():
    stream = BytesIO()
    Image.new('RGB', (37, 23), (30, 90, 170)).save(stream, 'JPEG', quality=90)
    original = stream.getvalue()
    data = original[:-2] + b'\xff' * (CAP - len(original)) + original[-2:]
    assert len(data) == CAP
    with Image.open(BytesIO(data)) as image:
        image.load()
        assert image.size == (37, 23)
        assert max(abs(a - b) for a, b in zip(image.getpixel((10, 10)), (30, 90, 170))) <= 2
    return data


def start(directory, port=0):
    code = ('import json,sys;from pathlib import Path;from challenges.server import create_server;'
            's=create_server(Path(sys.argv[1]),int(sys.argv[2]));'
            'print(json.dumps({"port":s.server_port}),flush=True);'
            's.serve_forever()')
    process = subprocess.Popen([sys.executable, '-u', '-c', code, str(directory), str(port)],
                               cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    line = process.stdout.readline()
    if not line:
        process.wait(timeout=10)
        raise RuntimeError('Isolated capacity server did not start: ' + process.stderr.read()[:400])
    return process, json.loads(line)['port']


def stop(process):
    if process.poll() is None:
        process.terminate()
        process.wait(timeout=20)


def request(port, method, path, body=None, token=None, expected=200):
    headers = {}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if isinstance(body, dict):
        body = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    elif body is not None:
        headers['Content-Type'] = 'application/octet-stream'
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=30)
    try:
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        raw = response.read()
        assert response.status == expected, (response.status, expected, raw[:200])
        if response.getheader('Content-Type', '').startswith('application/json'):
            return json.loads(raw)
        return raw
    finally:
        connection.close()


def payload(revision, jpeg):
    metadata = json.dumps({'revision': revision, 'text': 'Capacity receipt — supplied copy',
                           'url': None}, ensure_ascii=False).encode()
    return b'FCEVID01' + len(metadata).to_bytes(4, 'little') + len(jpeg).to_bytes(4, 'little') + metadata + jpeg


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    output = args.output or Path(tempfile.mkdtemp(prefix='friendly-image-capacity-'))
    if args.output:
        output.mkdir(parents=True, exist_ok=False)
    data_dir = output / 'data'
    jpeg = generate()
    (output / 'exact-limit.jpg').write_bytes(jpeg)
    receipt = {'schemaVersion': 1, 'scope': 'Actual HTTP, SQLite BLOBs and fresh service process; legal JPEG marker-fill byte limits, not complex photograph or source-dimension maxima.',
               'jpeg': {'bytes': len(jpeg), 'sha256': digest(jpeg), 'width': 37, 'height': 23},
               'status': 'running'}
    process, port = start(data_dir)
    receipt['originalPid'] = process.pid
    seats, snapshots = [], []
    started = time.monotonic()
    try:
        for number in range(20):
            terms = {'title': f'Capacity challenge {number + 1}', 'description': 'Bounded retained image acceptance',
                     'successCriteria': 'Both participants inspect the copies', 'evidenceRule': 'Supplied copies only',
                     'stake': 'bragging-rights', 'deadline': int(time.time() * 1000) + 3600000}
            created = request(port, 'POST', '/api/challenges', {'name': 'Capacity proposer', 'terms': terms}, expected=201)
            path = '/api/challenges/' + created['challengeId']
            joined = request(port, 'POST', path + '/join', {'name': 'Capacity opponent', 'inviteToken': created['inviteToken']})
            snap = request(port, 'POST', path + '/accept', {'revision': joined['challenge']['revision'], 'termsVersion': 1}, joined['token'])
            for _ in range(8):
                snap = request(port, 'POST', path + '/evidence/image', payload(snap['revision'], jpeg), created['token'])
            assert len(snap['evidence']) == 8
            assert sum(item['image']['bytes'] for item in snap['evidence']) == 4 * 1024 * 1024
            rejected = request(port, 'POST', path + '/evidence/image', payload(snap['revision'], jpeg), created['token'], expected=409)
            assert rejected['code'] == 'limit'
            seats.append((path, created['token'], joined['token']))
            snapshots.append(snap)
            print(json.dumps({'challenges': number + 1, 'retainedImages': (number + 1) * 8}), flush=True)
        denied = request(port, 'POST', '/api/challenges', {'name': 'Extra', 'terms': terms}, expected=409)
        assert denied['code'] == 'limit'
        with sqlite3.connect(data_dir / 'challenges.sqlite3') as database:
            count, total = database.execute('SELECT count(*),sum(length(data)) FROM evidence_images').fetchone()
        assert (count, total) == (160, 80 * 1024 * 1024)
        path, first_token, opponent_token = seats[0]
        report = request(port, 'GET', path + '/export/images', token=opponent_token)
        (output / 'complete-images.html').write_bytes(report)
        encoded = re.findall(rb'data:image/jpeg;base64,([A-Za-z0-9+/=]+)', report)
        assert len(encoded) == 8
        assert all(base64.b64decode(item, validate=True) == jpeg for item in encoded)
        for _, proposer, opponent in seats:
            assert proposer.encode() not in report and opponent.encode() not in report
        assert b'<script' not in report.lower()
        record = PublicRecord()
        record.feed(report.decode())
        public = request(port, 'GET', path + '/export', token=first_token)
        assert len(record.records) == 1 and record.records[0]['challenge'] == public['challenge']
        stop(process)
        process, reopened_port = start(data_dir, port)
        assert reopened_port == port and process.pid != receipt['originalPid']
        receipt['reopenedPid'] = process.pid
        for (path, token, _), expected in zip(seats, snapshots):
            actual = request(port, 'GET', path, token=token)
            expected['myRole'] = actual['myRole']
            expected['serverTime'] = actual['serverTime']
            assert actual == expected
            for item in actual['evidence']:
                binary = request(port, 'GET', path + '/evidence/' + item['id'] + '/image', token=token)
                assert binary == jpeg and digest(binary) == item['image']['sha256']
        cross_path = seats[0][0] + '/evidence/' + snapshots[0]['evidence'][0]['id'] + '/image'
        request(port, 'GET', cross_path, token=seats[1][1], expected=401)
        receipt.update(status='passed', challenges=20, images=count, retainedBytes=total,
                       maximumChallengeBytes=4 * 1024 * 1024,
                       html={'bytes': len(report), 'sha256': digest(report), 'embeddedImages': 8,
                             'exactJpegBytes': True, 'completePublicRecord': True},
                       restart={'exactAll160Media': True, 'exactAll20RecordsExcludingResponseClockAndViewer': True},
                       durationSeconds=round(time.monotonic() - started, 3))
        print(json.dumps(receipt, indent=2), flush=True)
    finally:
        stop(process)
        (output / 'verification.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main()
