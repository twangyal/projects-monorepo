import hashlib,io,json,unittest,zipfile
from pathlib import Path
from garment_warm_failure_audit import audit
ARCHIVE=Path(__file__).with_name('results')/'garment-warm-native-failure.zip'
class WarmFailureAudit(unittest.TestCase):
 def test_complete_failure_has_only_initial_frame(self):
  r=audit(ARCHIVE)
  self.assertEqual((r['native_files_verified'],r['raw_frames'],r['motion_frames']),(82,1,0))
 def test_false_success_missing_frame_changed_rest_and_invented_motion_refuse(self):
  with zipfile.ZipFile(ARCHIVE) as z:original={n:z.read(n) for n in z.namelist()}
  prefix='native-cache/sessions/cpu-garment-soft/session/'
  for mode in ['status','frame','rest','motion','warm','source']:
   files=original.copy();r=json.loads(files['receipt.json'])
   if mode=='status':r['status']='passed_garment_motion_probe'
   if mode=='frame':del files[prefix+'output/vert_0.bin']
   if mode=='rest':files[prefix+'bin/rest_vert.bin']=bytes(len(files[prefix+'bin/rest_vert.bin']))
   if mode=='motion':files[prefix+'output/vert_1.bin']=files[prefix+'output/vert_0.bin']
   if mode=='warm':r['warm_start_parameters']['growth_frames']=46
   if mode=='source':r['source_sha256']['garment_warm_start.py']='invented'
   r['retained_native_files']=[{'path':n,'bytes':len(v),'sha256':hashlib.sha256(v).hexdigest()} for n,v in files.items() if n.startswith('native-cache/')]
   files['receipt.json']=json.dumps(r).encode();stream=io.BytesIO()
   with zipfile.ZipFile(stream,'w') as z:
    for n,v in files.items():z.writestr(n,v)
   stream.seek(0)
   with self.subTest(mode=mode),self.assertRaises(ValueError):audit(stream,verify_archive_hash=False)
