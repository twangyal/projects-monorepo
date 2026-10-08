import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import report


def not_run_fixture():
    return {'schemaVersion': 1, 'protocol': 'context-shapes-v1', 'status': 'not-run',
            'provenance': 'Test-only authored not-run fixture.',
            'protocolHash': None, 'generatorHash': None, 'manifestHash': None, 'environment': None,
            'readiness': {'status': 'pending', 'minimum': 0.8, 'neutralDevelopment': [], 'reason': None},
            'testSamples': [], 'examples': [], 'models': [], 'evaluations': [],
            'limitations': ['Test-only procedural fixture.'], 'error': None}


class ReportTests(unittest.TestCase):
    def test_not_run_is_truthful_and_detached(self):
        original = not_run_fixture()
        checked = report.validate_report(original)
        self.assertEqual(checked, original)
        checked['limitations'].append('changed')
        self.assertNotEqual(checked, original)
        self.assertEqual(json.loads(report.report_bytes(original)), original)

    def test_published_artifact_admits_its_actual_status(self):
        published = json.loads((Path(__file__).resolve().parents[2] / 'public/experiment-report.json').read_text())
        self.assertEqual(report.validate_report(published)['status'], published['status'])

    def test_not_run_cannot_smuggle_metrics_or_unsafe_metadata(self):
        original = not_run_fixture()
        for key, value in [('models', [{}]), ('schemaVersion', True), ('provenance', 'bad\0name'), ('protocolHash', 'a' * 64), ('error', 'failure'), ('status', 'complete')]:
            bad = copy.deepcopy(original)
            bad[key] = value
            with self.assertRaises(ValueError):
                report.validate_report(bad)


if __name__ == '__main__':
    unittest.main()
