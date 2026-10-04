"""Complete script-free HTML record with exact retained JPEG evidence."""

import base64
from hashlib import sha256
from html import escape

from . import domain
from .images import validate_jpeg

MAX_IMAGE_EXPORT_BYTES = 12 * 1024 * 1024


def _public_record(value):
    domain.fields(value, 'schemaVersion exportedAt challenge', 'Public export')
    version = value['schemaVersion']
    domain.require(type(version) is int and version in (1, 2), 'Unsupported public export schema.')
    exported_at = domain.integer(value['exportedAt'], 'Export time')
    challenge = value['challenge']
    domain.require(type(challenge) is dict and 'deadlinePassed' in challenge
                   and 'id' in challenge and 'events' in challenge, 'Invalid public challenge.')
    state = {key: item for key, item in challenge.items() if key != 'deadlinePassed'}
    replayed = domain._replay(state['events'], domain.identifier(state['id']), version)
    domain.require(domain.encode_json(replayed) == domain.encode_json(state),
                   'Public challenge disagrees with its complete audit.')
    domain.require(type(challenge['deadlinePassed']) is bool
                   and challenge['deadlinePassed'] == (exported_at >= state['terms']['deadline']),
                   'Public export deadline status disagrees with its export time.')
    # This checks the established complete JSON bound before any HTML expansion.
    encoded = domain.encode_json(value)
    return replayed, encoded


def render_image_export(public_export, images) -> bytes:
    """Admit complete record/media correspondence, then emit bounded inert HTML.

    The readable record preserves all public terms, evidence and audit fields.
    Matching hashes establish byte integrity, never authenticity of a claim.
    """
    try:
        state, encoded_record = _public_record(public_export)
        domain.require(type(images) is list and len(images) <= 8, 'Invalid export image list.')
        expected = [entry for entry in state['evidence'] if 'image' in entry]
        domain.require(len(images) == len(expected), 'Export must contain every retained image.')
        admitted = []
        for entry, member in zip(expected, images):
            domain.require(type(member) in (tuple, list) and len(member) == 3,
                           'Invalid export image member.')
            evidence_id, supplied_descriptor, data = member
            domain.require(evidence_id == entry['id'],
                           'Export images must match the evidence order without duplicates.')
            descriptor = domain.validate_image_descriptor(supplied_descriptor)
            domain.require(descriptor == entry['image'], 'Export image descriptor does not match.')
            domain.require(type(data) is bytes and len(data) == descriptor['bytes'],
                           'Export image byte count does not match.')
            domain.require(sha256(data).hexdigest() == descriptor['sha256'],
                           'Export image digest does not match.')
            domain.require(validate_jpeg(data) == descriptor,
                           'Export JPEG dimensions or framing do not match.')
            admitted.append((entry, data))
    except (KeyError, TypeError, ValueError, RecursionError):
        raise domain.DomainError('invalid_request', 'Supply a complete bounded public export and '
                                 'its matching retained images.', 400) from None

    parts = []
    size = 0

    def append(value):
        nonlocal size
        block = value.encode('utf-8')
        domain.require(size + len(block) <= MAX_IMAGE_EXPORT_BYTES,
                       'Image record export exceeds the 12 MiB limit.', 'limit', 409)
        size += len(block)
        parts.append(block)

    append('<!doctype html><html lang="en"><head><meta charset="utf-8">'
           '<meta name="viewport" content="width=device-width,initial-scale=1">'
           '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
           'img-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'
           '<title>Friendly Challenges — public image evidence record</title>'
           '<style>body{font-family:system-ui,sans-serif;max-width:70rem;margin:2rem auto;'
           'padding:0 1rem}pre,p{white-space:pre-wrap;overflow-wrap:anywhere}'
           'img{max-width:100%;height:auto}article{border-top:1px solid #888;padding:1rem 0}'
           'dt{font-weight:bold}dd{overflow-wrap:anywhere}</style></head><body>'
           '<h1>Friendly Challenges — public evidence record</h1>'
           '<p>These supplied images are resized, reencoded JPEG copies. Original images and '
           'capture metadata are not retained. Capture time, identity, image authenticity and '
           'whether an image proves a claim are not verified. Receipt time is the service\'s '
           'recorded time. Hashes establish retained-byte integrity only. '
           'This readable record does not restore private seats or access capabilities.</p>')
    for entry, data in admitted:
        descriptor = entry['image']
        append(f'<article id="evidence-{entry["id"]}"><h2>Image evidence by '
               f'{entry["author"]}</h2><p>{escape(entry["text"], quote=False)}</p>')
        if entry['url'] is not None:
            append(f'<p>Supplied link: {escape(entry["url"], quote=False)}</p>')
        append(f'<dl><dt>Evidence ID</dt><dd>{entry["id"]}</dd>'
               f'<dt>Receipt time (Unix milliseconds)</dt><dd>{entry["createdAt"]}</dd>'
               f'<dt>Late at receipt</dt><dd>{str(entry["late"]).lower()}</dd>'
               f'<dt>Dimensions</dt><dd>{descriptor["width"]} × {descriptor["height"]}</dd>'
               f'<dt>JPEG bytes</dt><dd>{descriptor["bytes"]}</dd>'
               f'<dt>SHA-256</dt><dd>{descriptor["sha256"]}</dd></dl>')
        # All attribute values above are admitted identifiers, integers or fixed text.
        append('<img alt="Supplied normalized image; association is unverified" '
               f'width="{descriptor["width"]}" height="{descriptor["height"]}" '
               'src="data:image/jpeg;base64,')
        append(base64.b64encode(data).decode('ascii'))
        append('"></article>')
    append('<h2>Complete public record, terms, outcome and audit</h2>'
           '<p>The literal JSON below is readable data. It contains no private capability fields. '
           'Plain JSON export includes image descriptors; this HTML also includes their exact '
           'JPEG bytes.</p><pre>')
    append(escape(encoded_record, quote=False))
    append('</pre></body></html>')
    return b''.join(parts)
