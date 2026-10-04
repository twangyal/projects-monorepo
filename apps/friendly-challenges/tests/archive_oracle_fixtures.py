"""Original #103 archive fixtures; no archive/domain producer imports."""
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sqlite3
import stat
import struct
import zlib

from PIL import Image

LEGACY_ID = '1' * 32
IMAGE_ID = '2' * 32
EVIDENCE_IDS = ('a' * 32, 'b' * 32)
CREATED = 1900000000000
CHALLENGES_SQL = 'CREATE TABLE challenges (id TEXT PRIMARY KEY NOT NULL, record TEXT NOT NULL)'
IMAGES_SQL = (
    'CREATE TABLE evidence_images ('
    'challenge_id TEXT NOT NULL,evidence_id TEXT NOT NULL,data BLOB NOT NULL,'
    "CHECK(typeof(data)='blob' AND length(data) BETWEEN 1 AND 524288),"
    'PRIMARY KEY(challenge_id,evidence_id),'
    'FOREIGN KEY(challenge_id) REFERENCES challenges(id))'
)


def jpeg(width, height, phase):
    image = Image.new('RGB', (width, height))
    image.putdata([((x * 17 + phase) % 256, (y * 29 + phase) % 256,
                    (x * 11 + y * 7 + phase) % 256)
                   for y in range(height) for x in range(width)])
    output = BytesIO()
    image.save(output, format='JPEG', quality=87, subsampling=0)
    return output.getvalue()


def private_record(challenge_id, *, image_payloads=()):
    """Hand-built replay chain, never generated with production transitions."""
    terms = {'title': 'Café 🌿 original', 'description': 'Line one\r\n\tLine two Ω',
             'successCriteria': 'Compare two supplied images', 'evidenceRule': 'Keep exact bytes',
             'stake': 'pick-a-movie', 'deadline': CREATED + 10000}
    state = {'id': challenge_id, 'revision': 1, 'status': 'proposed', 'termsVersion': 1,
             'terms': deepcopy(terms), 'acceptedAt': None, 'createdAt': CREATED,
             'profiles': {'proposer': {'name': 'Zoë'}, 'opponent': None, 'arbiter': None},
             'evidence': [], 'events': [
                 {'seq': 1, 'at': CREATED, 'actor': 'proposer', 'kind': 'created',
                  'details': {'name': 'Zoë', 'terms': deepcopy(terms), 'termsVersion': 1}}],
             'resultProposal': None, 'voidProposal': None, 'arbiterNomination': None,
             'resolution': None, 'limitsUsed': {'termsEdits': 0, 'resultProposals': 0,
                 'arbiterNominations': 0, 'opponentInvites': 1, 'arbiterInvites': 0}}
    hashes = {'proposer': '3' * 64, 'opponent': None, 'arbiter': None,
              'opponentInvite': '4' * 64, 'arbiterInvite': None}
    if image_payloads:
        state.update(status='active', acceptedAt=CREATED + 2, revision=3)
        state['profiles']['opponent'] = {'name': '李'}
        state['events'].extend([
            {'seq': 2, 'at': CREATED + 1, 'actor': 'opponent', 'kind': 'opponent_joined',
             'details': {'name': '李'}},
            {'seq': 3, 'at': CREATED + 2, 'actor': 'opponent', 'kind': 'accepted',
             'details': {'termsVersion': 1}}])
        hashes.update(opponent='5' * 64, opponentInvite=None)
        for i, (data, width, height) in enumerate(image_payloads):
            at = CREATED + (3 if i == 0 else 10001)
            item = {'id': EVIDENCE_IDS[i], 'author': ('proposer', 'opponent')[i],
                    'text': ('Literal <script>never execute</script> Ω', 'Second receipt\n遅い')[i],
                    'url': None if i == 0 else 'https://example.org/supplied',
                    'createdAt': at, 'late': i == 1,
                    'image': {'mime': 'image/jpeg', 'bytes': len(data), 'width': width,
                              'height': height, 'sha256': sha256(data).hexdigest()}}
            state['evidence'].append(item)
            state['revision'] += 1
            state['events'].append({'seq': state['revision'], 'at': at,
                                    'actor': item['author'], 'kind': 'evidence_image_added',
                                    'details': {'evidence': deepcopy(item)}})
    return {'hashes': hashes, 'state': state, 'schemaVersion': 2 if image_payloads else 1}


def original_fixture():
    images = (jpeg(11, 7, 13), jpeg(13, 9, 47))
    legacy = private_record(LEGACY_ID)
    active = private_record(IMAGE_ID, image_payloads=((images[0], 11, 7), (images[1], 13, 9)))
    # Distinct legal formatting, including whitespace outside the JSON object.
    records = ((LEGACY_ID, (' \r\n\t' + json.dumps(legacy, ensure_ascii=False, indent='\t')
                           + '\r\n ').encode('utf-8')),
               (IMAGE_ID, json.dumps(active, ensure_ascii=False,
                                    separators=(' ,\n', ' : ')).encode('utf-8')))
    media = tuple((IMAGE_ID, evidence, data) for evidence, data in zip(EVIDENCE_IDS, images))
    return records, media


def source_database(root, records, media=(), version=2):
    root = Path(root)
    root.mkdir()
    (root / '.server.lock').write_bytes(b'original lock bytes\n')
    with sqlite3.connect(root / 'challenges.sqlite3') as db:
        db.execute(CHALLENGES_SQL)
        if version == 2:
            db.execute(IMAGES_SQL)
        db.execute(f'PRAGMA user_version={version}')
        db.executemany('INSERT INTO challenges(id,record) VALUES (?,?)',
                       [(identity, raw.decode('utf-8')) for identity, raw in records])
        if version == 2:
            db.executemany('INSERT INTO evidence_images VALUES (?,?,?)', media)
    return root


def manifest(members, version=2):
    return {'schemaVersion': 1, 'kind': 'friendly-challenges-library',
            'createdAtMs': CREATED, 'sourceSchemaVersion': version,
            'members': [{'name': name, 'bytes': len(raw), 'sha256': sha256(raw).hexdigest()}
                        for name, raw in members]}


def payload_members(records, media=()):
    return [(f'records/{identity}.json', raw) for identity, raw in records] + [
        (f'images/{identity}/{evidence}.jpg', raw) for identity, evidence, raw in media]


def physical_zip(members):
    """Exact independent STORED dialect, with explicit headers/CRC/central offsets."""
    body, directory = bytearray(), bytearray()
    for name, raw in members:
        name_bytes = name.encode('ascii')
        crc, size, offset = zlib.crc32(raw), len(raw), len(body)
        body.extend(struct.pack('<IHHHHHIIIHH', 0x04034B50, 20, 0, 0, 0, 33,
                                crc, size, size, len(name_bytes), 0))
        body.extend(name_bytes)
        body.extend(raw)
        directory.extend(struct.pack('<IHHHHHHIIIHHHHHII', 0x02014B50, 788, 20,
                                     0, 0, 0, 33, crc, size, size, len(name_bytes),
                                     0, 0, 0, 0, (stat.S_IFREG | 0o600) << 16, offset))
        directory.extend(name_bytes)
    return bytes(body + directory + struct.pack('<IHHHHIIH', 0x06054B50, 0, 0,
                 len(members), len(members), len(directory), len(body), 0))


def archive_bytes(records, media=(), version=2, *, transform=None):
    members = payload_members(records, media)
    meta = manifest(members, version)
    if transform:
        transform(meta)
    raw = json.dumps(meta, ensure_ascii=False, sort_keys=True,
                     separators=(',', ':')).encode('utf-8')
    return physical_zip([('manifest.json', raw), *members])


def file_snapshot(root):
    return {path.name: path.read_bytes() for path in Path(root).iterdir() if path.is_file()}
