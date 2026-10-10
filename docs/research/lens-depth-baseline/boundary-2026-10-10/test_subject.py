import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location('subject', Path(__file__).with_name('subject.py'))
subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)


class SubjectDiagnosticTests(unittest.TestCase):
    def test_pixel_centers_and_background_hole(self):
        outer = [[0, 0], [1, 0], [1, 1], [0, 1]]
        hole = [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]]
        actual = subject.reference_mask(4, 4, [outer], [hole])
        np.testing.assert_array_equal(actual, [[1, 1, 1, 1], [1, 0, 0, 1], [1, 0, 0, 1], [1, 1, 1, 1]])
        np.testing.assert_array_equal(subject.reference_mask(4, 4, [list(reversed(outer))], [list(reversed(hole))]), actual)

    def test_four_connectivity_does_not_cross_diagonal_or_disconnected_band(self):
        band = np.array([[1, 0, 1], [1, 1, 0], [0, 0, 1]], dtype=bool)
        actual = subject.component(band, 0, 0)
        np.testing.assert_array_equal(actual, [[1, 0, 0], [1, 1, 0], [0, 0, 0]])
        self.assertFalse(subject.component(band, 1, 0).any())

    def test_confusion_and_edit_proxy_have_independent_expected_counts(self):
        reference = np.array([[1, 1], [0, 0]], dtype=bool)
        candidate = np.array([[1, 0], [1, 0]], dtype=bool)
        metrics = subject.measure(candidate, reference)
        self.assertEqual(metrics, {'truePositive': 1, 'falsePositive': 1, 'falseNegative': 1, 'trueNegative': 1, 'differentPixels': 2, 'differentFraction': 0.5, 'iou': 1 / 3})
        self.assertEqual(subject.measure(np.ones((2, 2), bool), reference)['differentPixels'], 2)
        self.assertEqual(subject.measure(np.zeros((2, 2), bool), reference)['differentPixels'], 2)


if __name__ == '__main__':
    unittest.main()
