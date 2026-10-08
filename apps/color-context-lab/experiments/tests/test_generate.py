import hashlib
import json
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import generate


class GeneratorTests(unittest.TestCase):
    def test_protocol_is_canonical_and_frozen(self):
        protocol = generate.load_protocol()
        self.assertEqual(generate.canonical_bytes(protocol), (Path(generate.__file__).parent / 'protocol.json').read_bytes())
        self.assertEqual(protocol['modelSeeds'], [1729, 2718, 3141])
        self.assertEqual(protocol['assignments']['algorithm'], 'fresh-PCG64-per-arm-same-permutation')
        bad = json.loads(json.dumps(protocol))
        bad['learner']['eta0'] = 0.02
        with self.assertRaises(ValueError):
            generate.generate_manifest(bad)

    def test_literal_axis_aligned_coverage(self):
        family = {'label': 0, 'cx': 12, 'cy': 12, 'halfLength': 8, 'halfThickness': 2, 'radius': 6, 'rotation': 0}
        # Override the separately authored unit family offset, not protocol samples.
        protocol = generate.load_protocol()
        protocol['geometry']['variants'] = [[0, 0], [0, 0]]
        for label, covered in [(0, 64), (1, 64), (2, 112)]:
            family['label'] = label
            pixels = generate.render_center(family, 0, protocol)
            self.assertEqual(pixels.shape, (24, 24, 3))
            self.assertEqual(int(np.sum(pixels[:, :, 0] == 64)), covered)
            self.assertTrue(np.array_equal(pixels[:, :, 0], pixels[:, :, 1]))
        family['label'] = 3
        values, counts = np.unique(generate.render_center(family, 0, protocol)[:, :, 0], return_counts=True)
        self.assertEqual(dict(zip(values.tolist(), counts.tolist())), {64: 96, 88: 16, 136: 8, 184: 4, 192: 452})

    def test_full_manifest_split_assignment_and_mask_gates(self):
        manifest = generate.generate_manifest()
        self.assertEqual(len(manifest['families']), 1120)
        self.assertEqual(generate.validate_manifest(manifest), manifest)
        hashes = [v['centerSha256'] for f in manifest['families'] for v in f['variants']]
        self.assertEqual(len(set(hashes)), 2240)
        raw, labels, ids = generate.dataset(manifest, 'train', 'correlated')
        masked, _, _ = generate.dataset(manifest, 'train', 'correlated', True)
        independent, _, _ = generate.dataset(manifest, 'train', 'independent', True)
        neutral, _, _ = generate.dataset(manifest, 'train', 'neutral')
        self.assertEqual(raw.shape, (1280, 32, 32, 3))
        self.assertEqual(ids[0], 'train-c0-f000-v0')
        self.assertEqual(ids[-1], 'train-c3-f159-v1')
        self.assertEqual(labels.tolist().count(0), 320)
        self.assertTrue(np.array_equal(masked, independent))
        self.assertTrue(np.array_equal(masked, neutral))
        self.assertTrue(np.array_equal(raw[:, 4:28, 4:28], neutral[:, 4:28, 4:28]))
        self.assertAlmostEqual(float(np.sqrt(np.mean((raw.astype(float) - neutral.astype(float)) ** 2))), np.sqrt(84))
        bad = json.loads(json.dumps(manifest))
        bad['families'][0]['variants'][0]['centerSha256'] = hashlib.sha256(b'wrong').hexdigest()
        with self.assertRaises(ValueError):
            generate.validate_manifest(bad)

    def test_source_fingerprint_uses_framed_exact_file_bytes(self):
        root = Path(generate.__file__).parent.parent
        frame = bytearray()
        for name in ['experiments/generate.py', 'experiments/report.py', 'experiments/requirements.txt', 'experiments/run.py']:
            data = (root / name).read_bytes()
            frame.extend(name.encode() + b'\0' + str(len(data)).encode() + b'\0' + data)
        self.assertEqual(generate.source_hash(), hashlib.sha256(frame).hexdigest())


if __name__ == '__main__':
    unittest.main()
