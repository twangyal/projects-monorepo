"""Frozen three-second native evidence and re-signed semantic counterexamples."""
import hashlib,io,json,unittest,zipfile
from pathlib import Path
import garment_material_cohort_audit as module
ROOT=Path(__file__).with_name('results')
class DurationArchive(unittest.TestCase):
 def test_actual_duration_pairs_replay(self):
  results={}
  for profile in ['one','four']:
   r=module.audit(ROOT/f'garment-duration-{profile}.zip.xz',profile=profile,observation='three-second');results[profile]=r
   self.assertEqual(r['native_files_verified'],899 if profile=='one' else 926)
   self.assertEqual(r['trajectory']['saved_frames'],168 if profile=='one' else 181)
   self.assertEqual(r['two_material_bounded_motion_complete'],profile=='four')
   self.assertEqual(r['native_outcome'],'timed_out' if profile=='one' else 'passed_garment_motion_probe')
   self.assertEqual(r['only_changed_material_bin'],['param/tri-young-mod.bin'])
   self.assertEqual(r['one_second_prefix_identical_raw_frames'],{'soft':61,'stiff':61})
   for name,case in r['cases'].items():
    count=168 if profile=='one' and name=='stiff' else 181
    self.assertEqual(case['raw_frames'],count)
    self.assertEqual(case['completed_case'],count==181)
    windows=case['saved_motion_windows'];self.assertEqual(len(windows),3)
    self.assertEqual([(w['start_seconds'],w['end_seconds']) for w in windows[:2]],[(0.,1.),(1.,2.)])
    self.assertAlmostEqual(windows[-1]['end_seconds'],(count-1)/60)
    self.assertEqual(windows[-1]['saved_intervals'],47 if count==168 else 60)
  for name in ['soft','stiff']:
   hashes=results['one']['raw_frame_sha256'][name]
   self.assertEqual(hashes,results['four']['raw_frame_sha256'][name][:len(hashes)])
 def test_shorter_or_same_material_evidence_is_not_a_duration_study(self):
  for name in ['garment-canonical-one.zip','garment-material-one.zip']:
   with self.subTest(name=name),self.assertRaises(ValueError):module.audit(ROOT/name,profile='one',observation='three-second',verify_archive_hash=False)
 def test_resigned_duration_or_control_changes_are_refused(self):
  with zipfile.ZipFile(io.BytesIO(module.read_archive(ROOT/'garment-duration-four.zip.xz'))) as z:original={n:z.read(n) for n in z.namelist()}
  prefix='native-cache/sessions/cpu-garment-stiff/session/'
  for mode in ['late-frame','duration-receipt','duration-export','time-step','study-flag','execution-settings','rest','young','source']:
   files=original.copy();r=json.loads(files['receipt.json'])
   if mode=='late-frame':del files[prefix+'output/vert_180.bin']
   if mode=='duration-receipt':r['session_parameters']['frames']=60
   if mode=='duration-export':files[prefix+'param.toml']=files[prefix+'param.toml'].replace(b'frames = 180',b'frames = 60')
   if mode=='time-step':r['session_parameters']['dt']=1/60
   if mode=='study-flag':r['relaxation_study']=False
   if mode=='execution-settings':r['execution_settings']['requested_threads']=1
   if mode=='rest':files[prefix+'bin/rest_vert.bin']=bytes(len(files[prefix+'bin/rest_vert.bin']))
   if mode=='young':r['case_normalized_young']['stiff']=500.
   if mode=='source':r['source_sha256']['garment_native_export.py']='forged'
   r['retained_native_files']=[{'path':n,'bytes':len(v),'sha256':hashlib.sha256(v).hexdigest()} for n,v in files.items() if n.startswith('native-cache/')]
   files['receipt.json']=json.dumps(r).encode();stream=io.BytesIO()
   with zipfile.ZipFile(stream,'w') as z:
    for n,v in files.items():z.writestr(n,v)
   stream.seek(0)
   with self.subTest(mode=mode),self.assertRaises(ValueError):module.audit(stream,profile='four',observation='three-second',verify_archive_hash=False)
 def test_timeout_cannot_be_promoted_to_full_completion(self):
  with zipfile.ZipFile(io.BytesIO(module.read_archive(ROOT/'garment-duration-one.zip.xz'))) as z:files={n:z.read(n) for n in z.namelist()}
  r=json.loads(files['receipt.json']);r['status']='passed_garment_motion_probe';r['stage']='completed';r['fixture_step_outcome']='success';r['fixture_exit_code']=0
  files['receipt.json']=json.dumps(r).encode();stream=io.BytesIO()
  with zipfile.ZipFile(stream,'w') as z:
   for n,v in files.items():z.writestr(n,v)
  stream.seek(0)
  with self.assertRaises(ValueError):module.audit(stream,profile='one',observation='three-second',verify_archive_hash=False)
