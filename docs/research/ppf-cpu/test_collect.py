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
    def test_static_fixture_success_cannot_override_a_failed_execution_gate(self):
        receipt,_=self.collect({'status':'passed_static_fixture'},'failure',1);self.assertEqual(receipt['status'],'failed_execution_gate')
    def test_curved_fixture_success_cannot_override_a_failed_execution_gate(self):
        receipt,_=self.collect({'status':'passed_curved_fixture'},'failure',1);self.assertEqual(receipt['status'],'failed_execution_gate')
    def test_confirmed_pass_retains_original_measurements(self):
        receipt,_=self.collect({'status':'passed_upstream_fixture','held':{'crossings':0}},'success',0)
        self.assertEqual(receipt['status'],'passed_upstream_fixture');self.assertEqual(receipt['held'],{'crossings':0})
        self.assertEqual(len(receipt['retained_native_files']),3)

class RealFrameAdmission(unittest.TestCase):
    def test_frame_set_excludes_native_index_maps_and_requires_each_case(self):
        for omit in [False,True]:
            with self.subTest(omit=omit),tempfile.TemporaryDirectory() as temp:
                root=Path(temp);out=root/'report';cache=root/'cache';out.mkdir()
                (out/'receipt.json').write_text(json.dumps({'status':'passed_upstream_fixture','frames_per_case':2}))
                (out/'fixture-exit-code.txt').write_text('0')
                for name in ['cpu-contact-held','cpu-contact-through']:
                    session=cache/'sessions'/name/'session';(session/'output').mkdir(parents=True);(session/'bin').mkdir()
                    (session/'bin'/'vert_dmap.bin').write_bytes(b'index map')
                    for i in range(2):
                        if omit and name=='cpu-contact-through' and i==1:continue
                        (session/'output'/f'vert_{i}.bin').write_bytes(b'frame')
                result=subprocess.run([sys.executable,str(SCRIPT),'--out',str(out),'--cache',str(cache),'--outcome','success'],capture_output=True,text=True)
                receipt=json.loads((out/'receipt.json').read_text())
                self.assertEqual(result.returncode,1 if omit else 0,result.stdout+result.stderr)
                self.assertEqual(receipt['status'],'failed_evidence_collection' if omit else 'passed_upstream_fixture')

class TensileFrameAdmission(unittest.TestCase):
    def test_three_case_frame_sets_and_missing_control(self):
        for omit in [False,True]:
            with self.subTest(omit=omit),tempfile.TemporaryDirectory() as temp:
                root=Path(temp);out=root/'report';cache=root/'cache';out.mkdir()
                (out/'receipt.json').write_text(json.dumps({'status':'passed_tensile_fixture','frames_per_case':2,'case_names':['soft','stiff','density'],'case_session_prefix':'cpu-tensile-'}))
                (out/'fixture-exit-code.txt').write_text('0')
                for case in ['soft','stiff','density']:
                    output=cache/'sessions'/('cpu-tensile-'+case)/'session'/'output';output.mkdir(parents=True)
                    for i in range(2):
                        if omit and case=='density' and i==1:continue
                        (output/f'vert_{i}.bin').write_bytes(b'frame')
                result=subprocess.run([sys.executable,str(SCRIPT),'--out',str(out),'--cache',str(cache),'--outcome','success'],capture_output=True,text=True)
                receipt=json.loads((out/'receipt.json').read_text())
                self.assertEqual(result.returncode,1 if omit else 0,result.stdout+result.stderr)
                self.assertEqual(receipt['status'],'failed_evidence_collection' if omit else 'passed_tensile_fixture')

if __name__=='__main__':unittest.main()

class GarmentFrameAdmission(unittest.TestCase):
    def test_garment_motion_success_requires_both_complete_case_frame_sets(self):
        for omit in [False,True]:
            with self.subTest(omit=omit),tempfile.TemporaryDirectory() as temp:
                root=Path(temp);out=root/'report';cache=root/'cache';out.mkdir()
                (out/'receipt.json').write_text(json.dumps({'status':'passed_garment_motion_probe','frames_per_case':2,'case_names':['soft','stiff'],'case_session_prefix':'cpu-garment-'}))
                (out/'fixture-exit-code.txt').write_text('0')
                for case in ['soft','stiff']:
                    output=cache/'sessions'/('cpu-garment-'+case)/'session'/'output';output.mkdir(parents=True)
                    for i in range(2):
                        if omit and case=='stiff' and i==1:continue
                        (output/f'vert_{i}.bin').write_bytes(b'frame')
                result=subprocess.run([sys.executable,str(SCRIPT),'--out',str(out),'--cache',str(cache),'--outcome','success'],capture_output=True,text=True)
                receipt=json.loads((out/'receipt.json').read_text())
                self.assertEqual(result.returncode,1 if omit else 0,result.stdout+result.stderr)
                self.assertEqual(receipt['status'],'failed_evidence_collection' if omit else 'passed_garment_motion_probe')
