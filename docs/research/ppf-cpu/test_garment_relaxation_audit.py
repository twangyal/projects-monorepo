from pathlib import Path
import unittest
from garment_clearance_audit import audit
ROOT=Path(__file__).with_name('results')
class RelaxationNativeAudit(unittest.TestCase):
 def test_short_archive_cannot_masquerade_as_one_second_observation(self):
  with self.assertRaisesRegex(ValueError,'cleared receipt'):
   audit(ROOT/'garment-clearance-native.zip',verify_archive_hash=False,observation='one-second')
 def test_unknown_observation_refuses(self):
  with self.assertRaises(ValueError):audit(ROOT/'garment-clearance-native.zip',observation='unbounded')
 def test_complete_one_second_native_evidence_replays(self):
  r=audit(ROOT/'garment-relaxation-native.zip',observation='one-second')
  self.assertTrue(r['two_material_bounded_motion_complete']);self.assertEqual(r['native_files_verified'],446)
  self.assertEqual(r['only_changed_material_bin'],['param/tri-young-mod.bin'])
  self.assertTrue(r['duration_control_comparison']['all_native_input_bins_identical'])
  for c in r['cases'].values():self.assertEqual((c['raw_frames'],c['motion_frames']),(61,60))
 def test_resigned_late_frame_or_short_completion_refuses(self):
  import hashlib,io,json,zipfile
  with zipfile.ZipFile(ROOT/'garment-relaxation-native.zip') as z:original={n:z.read(n) for n in z.namelist()}
  prefix='native-cache/sessions/cpu-garment-soft/session/'
  for short in [False,True]:
   files=original.copy();r=json.loads(files['receipt.json'])
   remove=range(19,61) if short else [60]
   for i in remove:del files[prefix+f'output/vert_{i}.bin']
   limit=19 if short else 60
   files[prefix+'output/data/frame_to_time.out']=b'\n'.join(files[prefix+'output/data/frame_to_time.out'].splitlines()[:limit])+b'\n'
   if short:r['cases']['soft']['frames']=19
   r['retained_native_files']=[{'path':n,'bytes':len(v),'sha256':hashlib.sha256(v).hexdigest()} for n,v in files.items() if n.startswith('native-cache/')]
   files['receipt.json']=json.dumps(r).encode();stream=io.BytesIO()
   with zipfile.ZipFile(stream,'w') as z:
    for n,v in files.items():z.writestr(n,v)
   stream.seek(0)
   with self.subTest(short=short),self.assertRaises(ValueError):audit(stream,verify_archive_hash=False,observation='one-second')
