import copy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from verify_quantum_clock import HERE, REPO, verify


class ReplayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/'cohort'
        shutil.copytree(HERE, self.root)

    def edit(self, name, mutate, refresh_hash=True):
        path = self.root/name
        value = json.loads(path.read_text())
        mutate(value)
        path.write_text(json.dumps(value))
        if refresh_hash:
            manifest = json.loads((self.root/'manifest.json').read_text())
            manifest['files'][name] = hashlib.sha256(path.read_bytes()).hexdigest()
            (self.root/'manifest.json').write_text(json.dumps(manifest))

    def terminal(self, value):
        return next(e['data'] for e in value['captured']['events'] if e['kind']=='terminal')

    def test_exact_retained_cohort_replays(self):
        self.assertEqual(verify(self.root, REPO), verify(HERE, REPO))

    def test_missing_receipt(self):
        (self.root/'receipts/baseline-00.json').unlink()
        with self.assertRaises(ValueError): verify(self.root, REPO)

    def test_hash_change_without_manifest_rewrite(self):
        self.edit('receipts/baseline-00.json', lambda v:v.update(row=1), False)
        with self.assertRaises(ValueError): verify(self.root, REPO)

    def test_ring_cannot_exceed_eight_rows(self):
        self.edit('receipts/instrumented-06.json', lambda v:self.terminal(v)['quantum']['rows'].append(copy.deepcopy(self.terminal(v)['quantum']['rows'][-1])))
        with self.assertRaisesRegex(ValueError, 'ring size'): verify(self.root, REPO)

    def test_ring_sequence_hole(self):
        self.edit('receipts/instrumented-06.json', lambda v:self.terminal(v)['quantum']['rows'][0].__setitem__(0, 1))
        with self.assertRaisesRegex(ValueError, 'ring sequence'): verify(self.root, REPO)

    def test_nonfinite_clock(self):
        self.edit('receipts/instrumented-06.json', lambda v:self.terminal(v)['quantum']['rows'][-1].__setitem__(3, float('nan')))
        with self.assertRaisesRegex(ValueError, 'entry clock'): verify(self.root, REPO)

    def test_receipt_error_order(self):
        def mutate(v):
            at = next(i for i,e in enumerate(v['captured']['events']) if e['kind']=='terminal')
            v['captured']['events'][at+1]['data']['reason']='other'
        self.edit('receipts/instrumented-06.json', mutate)
        with self.assertRaisesRegex(ValueError, 'ordering'): verify(self.root, REPO)

    def test_case_cannot_claim_success_without_backup_equality(self):
        self.edit('receipts/baseline-01.json', lambda v:v.update(afterHash='0'*64))
        with self.assertRaisesRegex(ValueError, 'backup equality'): verify(self.root, REPO)
