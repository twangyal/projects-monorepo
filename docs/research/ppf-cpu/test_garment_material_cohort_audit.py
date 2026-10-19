import unittest
from pathlib import Path
class MaterialCohort(unittest.TestCase):
 def test_same_material_and_unpatched_material_archives_are_refused(self):
  import garment_material_cohort_audit as module
  root=Path(__file__).with_name('results')
  for name in ['garment-canonical-one.zip','garment-relaxation-native.zip']:
   with self.subTest(archive=name),self.assertRaises(ValueError):module.audit(root/name,profile='one',verify_archive_hash=False)
 def test_resigned_changes_cannot_bypass_material_controls(self):
  import io,json,hashlib,zipfile
  import garment_material_cohort_audit as module
  root=Path(__file__).with_name('results')
  with zipfile.ZipFile(root/'garment-material-one.zip') as z:original={n:z.read(n) for n in z.namelist()}
  prefix='native-cache/sessions/cpu-garment-stiff/session/'
  for mode in ['rest','late-frame','timing','completion','young','source','dynamic-sidecar','command','host-environment','declared-patch']:
   files=original.copy();r=json.loads(files['receipt.json'])
   if mode=='rest':files[prefix+'bin/rest_vert.bin']=bytes(len(files[prefix+'bin/rest_vert.bin']))
   if mode=='late-frame':del files[prefix+'output/vert_60.bin']
   if mode=='timing':files[prefix+'output/data/frame_to_time.out']=b'0 0\n'
   if mode=='completion':r['cases']={}
   if mode=='young':r['case_normalized_young']['stiff']=500.
   if mode=='declared-patch':files['research-patch.json']=b'{}'
   if mode=='command':files[prefix+'command.sh']=files[prefix+'command.sh'].replace(b'"$@"',b'--frames 1')
   if mode=='host-environment':
    host=json.loads(files['thread-settings.json']);host['variables']['RAYON_NUM_THREADS']='4';files['thread-settings.json']=json.dumps(host).encode()
   if mode=='dynamic-sidecar':files[prefix+'dyn_param.txt']=b'0 1\n'
   if mode=='source':r['source_sha256']['garment_native_probe.py']='forged'
   r['retained_native_files']=[{'path':n,'bytes':len(v),'sha256':hashlib.sha256(v).hexdigest()} for n,v in files.items() if n.startswith('native-cache/')]
   files['receipt.json']=json.dumps(r).encode();stream=io.BytesIO()
   with zipfile.ZipFile(stream,'w') as z:
    for n,v in files.items():z.writestr(n,v)
   stream.seek(0)
   with self.subTest(mode=mode),self.assertRaises(ValueError):module.audit(stream,profile='one',verify_archive_hash=False)
 def test_actual_material_pairs_replay(self):
  import garment_material_cohort_audit as module
  root=Path(__file__).with_name('results')
  results=[]
  for profile in ['one','four']:
   result=module.audit(root/f'garment-material-{profile}.zip',profile=profile);results.append(result)
   self.assertEqual(result['native_files_verified'],446)
   self.assertEqual(result['only_changed_material_bin'],['param/tri-young-mod.bin'])
   self.assertTrue(result['original_material_reference_inputs_identical'])
   self.assertEqual(result['trajectory']['saved_frames'],61)
  self.assertEqual(results[0]['raw_frame_sha256'],results[1]['raw_frame_sha256'])
