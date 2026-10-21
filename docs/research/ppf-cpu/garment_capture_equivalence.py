"""Verify current-source captures against immutable historical garment geometry.

Historical envelope provenance is verified separately against its pinned checkout.
This check verifies every declared current source byte and the entire packet; it
never substitutes new hashes into an old research artifact.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

COLD_SOURCES = {'src/product.ts', 'src/media.ts', 'src/garment-drape.ts', 'src/native-garment-snapshot.ts', 'scripts/export-native-garment.ts', 'package-lock.json'}
WARM_SOURCES = COLD_SOURCES | {'src/native-garment-warm-start.ts', 'scripts/export-native-warm-start.ts'}
FIXTURES = {'blank-tee-94cm-body-v1': COLD_SOURCES, 'blank-tee-94cm-body-growth45-v1': WARM_SOURCES}


def compare(frozen, current, app):
    for envelope in (frozen, current):
        if not isinstance(envelope, dict) or set(envelope) != {'fixture', 'source_sha256', 'packet'}:
            raise ValueError('Invalid capture envelope.')
        fixture = envelope['fixture']
        if not isinstance(fixture, str) or fixture not in FIXTURES:
            raise ValueError('Unknown capture fixture.')
        sources = envelope['source_sha256']
        if not isinstance(sources, dict) or set(sources) != FIXTURES[fixture]:
            raise ValueError('Changed source manifest.')
        if any(not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest) for digest in sources.values()):
            raise ValueError('Invalid source hash.')
        if not isinstance(envelope['packet'], dict):
            raise ValueError('Invalid capture packet.')
    if frozen['fixture'] != current['fixture']:
        raise ValueError('Changed capture fixture.')
    for name, digest in current['source_sha256'].items():
        if hashlib.sha256((app / name).read_bytes()).hexdigest() != digest:
            raise ValueError('Current source hash mismatch: ' + name)
    # Canonical JSON retains numeric/boolean distinctions that Python == would lose.
    def canonical(packet):
        return json.dumps(packet, sort_keys=True, separators=(',', ':'), allow_nan=False)
    if canonical(frozen['packet']) != canonical(current['packet']):
        raise ValueError('Current application changed the frozen default garment packet.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('frozen', type=Path)
    parser.add_argument('current', type=Path)
    parser.add_argument('--app', required=True, type=Path)
    args = parser.parse_args()
    compare(json.loads(gzip.decompress(args.frozen.read_bytes())), json.loads(gzip.decompress(args.current.read_bytes())), args.app)
    print('Entire default packet unchanged; all current source hashes verified. Historical provenance remains separate.')


if __name__ == '__main__':
    main()
