from pathlib import Path
import unittest
from garment_clearance_audit import audit
ROOT=Path(__file__).with_name('results')
class ClearanceNativeAudit(unittest.TestCase):
 def test_old_contact_failed_pose_cannot_be_accepted_as_clear_preparation(self):
  with self.assertRaisesRegex(ValueError,'cleared blueprint'):audit(ROOT/'garment-warm-native-failure.zip',verify_archive_hash=False)

 def test_complete_two_material_native_motion_replays(self):
  r=audit(ROOT/'garment-clearance-native.zip')
  self.assertTrue(r['two_material_bounded_motion_complete'])
  self.assertEqual(r['native_files_verified'],278)
  self.assertEqual(r['only_changed_material_bin'],['param/tri-young-mod.bin'])
  for c in r['cases'].values():
   self.assertEqual((c['raw_frames'],c['motion_frames']),(19,18))
   self.assertGreater(c['metrics']['maximum_vertex_displacement_m'],1e-6)
  self.assertGreater(r['final_material_vertex_rms_difference_m'],1e-6)
 def test_resigned_semantic_changes_to_inputs_frames_timing_and_completion_refuse(self):
  import hashlib,io,json,zipfile
  with zipfile.ZipFile(ROOT/'garment-clearance-native.zip') as z:original={n:z.read(n) for n in z.namelist()}
  prefix='native-cache/sessions/cpu-garment-soft/session/'
  for mode in ['rest','frame','timing','control','source','completion']:
   files=original.copy();r=json.loads(files['receipt.json'])
   if mode=='rest':files[prefix+'bin/rest_vert.bin']=bytes(len(files[prefix+'bin/rest_vert.bin']))
   if mode=='frame':del files[prefix+'output/vert_1.bin']
   if mode=='timing':files[prefix+'output/data/frame_to_time.out']=b'0 0\n'
   if mode=='control':files[prefix+'bin/invented.bin']=b'changed'
   if mode=='source':r['source_sha256']['garment_clearance.py']='forged'
   if mode=='completion':r['cases']={}
   r['retained_native_files']=[{'path':n,'bytes':len(v),'sha256':hashlib.sha256(v).hexdigest()} for n,v in files.items() if n.startswith('native-cache/')]
   files['receipt.json']=json.dumps(r).encode();stream=io.BytesIO()
   with zipfile.ZipFile(stream,'w') as z:
    for n,v in files.items():z.writestr(n,v)
   stream.seek(0)
   with self.subTest(mode=mode),self.assertRaises(ValueError):audit(stream,verify_archive_hash=False)
