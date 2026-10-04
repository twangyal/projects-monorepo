from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run
import report


class LearnerTests(unittest.TestCase):
    def test_actual_fixed_learner_on_unrelated_tiny_color_fixture(self):
        # Eight authored solid images, not any protocol geometry/dev/test rows.
        images = np.full((8, 32, 32, 3), 128, dtype=np.uint8)
        labels = np.repeat(np.arange(4), 2)
        for i, label in enumerate(labels):
            images[i, 1 + label * 6:5 + label * 6] = 224
        model = run.fit_model(images, labels, 1729)
        features = ((images.astype(np.float32) - 128) / 128).reshape(8, -1)
        self.assertEqual(model.predict(features).tolist(), labels.tolist())
        self.assertEqual(model.n_iter_, 200)
        self.assertTrue(np.isfinite(model.coef_).all())
        self.assertGreater(float(np.abs(model.coef_).sum()), 0)
        self.assertEqual(run.fit_model(images, labels, 1729).coef_.tobytes(), model.coef_.tobytes())

    def test_metrics_literal_and_invalid_predictions(self):
        result = report.metrics([0, 1, 2, 2, 3, 3, 0, 1], [0, 0, 1, 1, 2, 2, 3, 3])
        self.assertEqual(result['confusion'], [[1, 1, 0, 0], [0, 0, 2, 0], [0, 0, 0, 2], [1, 1, 0, 0]])
        self.assertEqual(result['accuracy'], 0.125)
        self.assertEqual(result['balancedAccuracy'], 0.125)
        for invalid in [[True], [4], [float('nan')], []]:
            with self.assertRaises(ValueError):
                report.metrics(invalid, [0])

    def test_fit_refuses_missing_freeze_receipt_before_any_model(self):
        with self.assertRaisesRegex(ValueError, 'receipt'):
            run.fit_experiment({}, {})

class RunnerOwnershipTests(unittest.TestCase):
    def test_existing_output_is_refused_without_any_mutation(self):
        import tempfile
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            saved = output / 'experiment-report.json'
            saved.write_bytes(b'original-user-output')
            self.assertEqual(run.main(['--generate', '--output', temporary]), 2)
            self.assertEqual(saved.read_bytes(), b'original-user-output')
            self.assertEqual([p.name for p in output.iterdir()], ['experiment-report.json'])

    def test_pending_checkpoint_is_a_truthful_error_artifact(self):
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as temporary:
            state = report.empty_report('not-run')
            run._checkpoint(Path(temporary), state)
            artifact = report.validate_report(json.loads((Path(temporary) / 'experiment-report.json').read_text()))
            self.assertEqual(artifact['status'], 'error')
            self.assertEqual(artifact['readiness']['status'], 'pending')


if __name__ == '__main__':
    unittest.main()
