"""Research harness regressions; no model weights or network required."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import evaluate


class FrozenManifestTests(unittest.TestCase):
    def setUp(self):
        self.source = Path(__file__).with_name('frozen-smoke.json').read_bytes()
        self.manifest = json.loads(self.source)

    def test_default_retains_exact_original_protocol(self):
        self.assertTrue(hasattr(evaluate, 'load_manifest'), 'Missing explicit frozen-manifest loader')
        data, manifest = evaluate.load_manifest()
        self.assertEqual(data, self.source)
        self.assertEqual(manifest, self.manifest)

    def test_extension_requires_matching_hash_before_admission(self):
        self.assertTrue(hasattr(evaluate, 'load_manifest'), 'Missing explicit frozen-manifest loader')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'protocol.json'
            path.write_bytes(self.source)
            digest = hashlib.sha256(self.source).hexdigest()
            self.assertEqual(evaluate.load_manifest(path, digest)[0], self.source)
            with self.assertRaises(ValueError):
                evaluate.load_manifest(path, '0' * 64)
            with self.assertRaises(ValueError):
                evaluate.load_manifest(path)
            with self.assertRaises(ValueError):
                evaluate.load_manifest(None, digest)

    def test_frozen_invalid_coordinates_cannot_silently_sample_empty_or_wrapped_pixels(self):
        self.assertTrue(hasattr(evaluate, 'load_manifest'), 'Missing explicit frozen-manifest loader')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'protocol.json'
            for point in ([1, .5], [-.1, .5], [float('nan'), .5], [.5], [True, .5], ['.5', .5]):
                with self.subTest(point=point):
                    self.manifest['pairs'][0]['near'] = point
                    data = json.dumps(self.manifest).encode()
                    path.write_bytes(data)
                    with self.assertRaises(ValueError):
                        evaluate.load_manifest(path, hashlib.sha256(data).hexdigest())

    def test_empty_and_unbounded_pair_sets_are_rejected(self):
        self.assertTrue(hasattr(evaluate, 'load_manifest'), 'Missing explicit frozen-manifest loader')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'protocol.json'
            for pairs in ([], self.manifest['pairs'] * 13):
                self.manifest['pairs'] = pairs
                data = json.dumps(self.manifest).encode()
                path.write_bytes(data)
                with self.assertRaises(ValueError):
                    evaluate.load_manifest(path, hashlib.sha256(data).hexdigest())


if __name__ == '__main__':
    unittest.main()
