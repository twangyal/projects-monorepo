"""Current application equivalence must not rewrite immutable research provenance."""
import copy
import hashlib
import tempfile
import unittest
from pathlib import Path
from garment_capture_equivalence import compare


class CaptureEquivalenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name)
        paths = ['src/product.ts', 'src/media.ts', 'src/garment-drape.ts', 'src/native-garment-snapshot.ts', 'scripts/export-native-garment.ts', 'package-lock.json']
        self.sources = {}
        for name in paths:
            target = self.app / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(name)
            self.sources[name] = hashlib.sha256(target.read_bytes()).hexdigest()
        self.current = {'fixture': 'blank-tee-94cm-body-v1', 'source_sha256': self.sources, 'packet': {'position': [1, 2.5], 'nested': {'enabled': True}}}
        self.frozen = copy.deepcopy(self.current)
        self.frozen['source_sha256'] = {name: 'a' * 64 for name in paths}

    def test_current_source_can_change_but_entire_packet_must_match(self):
        self.assertIsNone(compare(self.frozen, self.current, self.app))
        for change in ['value', 'extra', 'type', 'fixture', 'sources', 'missing', 'bad_hash', 'envelope', 'frozen_hash', 'nan']:
            frozen, actual = copy.deepcopy(self.frozen), copy.deepcopy(self.current)
            if change == 'value': actual['packet']['position'][0] = 2
            if change == 'extra': actual['packet']['new'] = 1
            if change == 'type': actual['packet']['nested']['enabled'] = 1
            if change == 'fixture': actual['fixture'] = 'other'
            if change == 'sources': actual['source_sha256']['extra'] = '0' * 64
            if change == 'missing': actual['source_sha256'].pop('src/product.ts')
            if change == 'bad_hash': actual['source_sha256']['src/product.ts'] = '0' * 64
            if change == 'envelope': actual['extra'] = 1
            if change == 'frozen_hash': frozen['source_sha256']['src/product.ts'] = 'forged'
            if change == 'nan': actual['packet']['position'][0] = float('nan')
            with self.subTest(change=change), self.assertRaises(ValueError): compare(frozen, actual, self.app)

    def test_warm_fixture_verifies_its_additional_sources(self):
        for envelope in [self.frozen, self.current]:
            envelope['fixture'] = 'blank-tee-94cm-body-growth45-v1'
        with self.assertRaises(ValueError): compare(self.frozen, self.current, self.app)
        for name in ['src/native-garment-warm-start.ts', 'scripts/export-native-warm-start.ts']:
            target = self.app / name
            target.write_text(name)
            self.current['source_sha256'][name] = hashlib.sha256(target.read_bytes()).hexdigest()
            self.frozen['source_sha256'][name] = 'a' * 64
        self.assertIsNone(compare(self.frozen, self.current, self.app))
        self.current['fixture'] = self.frozen['fixture'] = 'unrecognized'
        with self.assertRaises(ValueError): compare(self.frozen, self.current, self.app)
