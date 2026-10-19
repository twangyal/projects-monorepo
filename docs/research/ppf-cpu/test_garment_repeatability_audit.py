from pathlib import Path
import io,json,hashlib,unittest,zipfile
import garment_repeatability_audit as module
ROOT=Path(__file__).with_name('results')
class RepeatabilityArchive(unittest.TestCase):
 def test_actual_identical_input_pairs_replay(self):
  for profile in ['one','four']:
   r=module.audit(ROOT/f'garment-repeatability-{profile}.zip',profile=profile)
   self.assertEqual(r['native_files_verified'],446)
   self.assertTrue(r['identical_native_input_bytes'])
   self.assertEqual(r['trajectory']['saved_frames'],61)
   self.assertEqual(r['identical_raw_frames'],1)
   self.assertGreater(r['trajectory']['maximum_vertex_difference_m'],.001)
 def test_material_discrimination_cannot_masquerade_as_repeatability(self):
  with self.assertRaises(ValueError):module.audit(ROOT/'garment-relaxation-native.zip',profile='one',verify_archive_hash=False)
 def test_resigned_changes_cannot_bypass_semantic_controls(self):
  with zipfile.ZipFile(ROOT/'garment-repeatability-one.zip') as z:original={n:z.read(n) for n in z.namelist()}
  prefix='native-cache/sessions/cpu-garment-second/session/'
  for mode in ['rest','late-frame','timing','completion','thread','source','dynamic-sidecar','command','host-environment','declared-patch']:
   files=original.copy();r=json.loads(files['receipt.json'])
   if mode=='rest':files[prefix+'bin/rest_vert.bin']=bytes(len(files[prefix+'bin/rest_vert.bin']))
   if mode=='late-frame':del files[prefix+'output/vert_60.bin']
   if mode=='timing':files[prefix+'output/data/frame_to_time.out']=b'0 0\n'
   if mode=='completion':r['cases']={}
   if mode=='thread':r['execution_settings']['requested_threads']=4
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
