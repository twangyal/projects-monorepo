import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('collect.py')

class EvidenceCollection(unittest.TestCase):
    def collect(self, initial, outcome, code=None):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);out=root/'report';cache=root/'cache';out.mkdir();session=cache/'cpu-contact-held'/'output';session.mkdir(parents=True)
            (session/'vert_0.bin').write_bytes(b'\x00'*12)
            (session/'stdout.log').write_text('early native diagnostic\nlast native line\n')
            (session/'stderr.log').write_text('native stderr\n')
            if initial is not None:(out/'receipt.json').write_text(json.dumps(initial))
            if code is not None:(out/'fixture-exit-code.txt').write_text(str(code))
            result=subprocess.run([sys.executable,str(SCRIPT),'--out',str(out),'--cache',str(cache),'--outcome',outcome],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            receipt=json.loads((out/'receipt.json').read_text())
            copied={p.name:p.read_bytes() for p in (out/'native-cache').rglob('*') if p.is_file()}
            return receipt,copied
    def test_timeout_retains_initial_receipt_and_full_native_logs_and_frames(self):
        receipt,copied=self.collect({'schema':1,'status':'started'},'failure',124)
        self.assertEqual(receipt['status'],'timed_out');self.assertEqual(receipt['fixture_exit_code'],124)
        self.assertEqual(copied['stdout.log'],b'early native diagnostic\nlast native line\n')
        self.assertEqual(copied['stderr.log'],b'native stderr\n');self.assertEqual(copied['vert_0.bin'],b'\x00'*12)
    def test_missing_receipt_is_not_reported_as_physics_success(self):
        receipt,_=self.collect(None,'skipped');self.assertEqual(receipt['status'],'not_executed')
    def test_failed_execution_gate_overrides_a_claimed_pass(self):
        receipt,_=self.collect({'status':'passed_upstream_fixture'},'failure',1);self.assertEqual(receipt['status'],'failed_execution_gate')
    def test_confirmed_pass_retains_original_measurements(self):
        receipt,_=self.collect({'status':'passed_upstream_fixture','held':{'crossings':0}},'success',0)
        self.assertEqual(receipt['status'],'passed_upstream_fixture');self.assertEqual(receipt['held'],{'crossings':0})
        self.assertEqual(len(receipt['retained_native_files']),3)

if __name__=='__main__':unittest.main()
