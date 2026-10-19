"""Semantic tests using an explicitly synthetic single-case envelope.

The source is a retained real pair, but this transformed envelope is never an
accepted native run. Only test-scoped registry patches admit it; production has
no registered fixed-material evidence until official artifacts are retained.
"""
import hashlib,io,json,math,struct,unittest,zipfile
from unittest.mock import patch
from pathlib import Path
import garment_fixed_material_audit as module
ROOT=Path(__file__).with_name('results')

def archive(files):
 stream=io.BytesIO()
 with zipfile.ZipFile(stream,'w') as z:
  for name,value in files.items():z.writestr(name,value)
 stream.seek(0);return stream

def resign(files,r):
 r['retained_native_files']=[{'path':n,'bytes':len(v),'sha256':hashlib.sha256(v).hexdigest()} for n,v in files.items() if n.startswith('native-cache/')]
 files['receipt.json']=json.dumps(r).encode();return archive(files)

class FixedMaterialSemantics(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with zipfile.ZipFile(io.BytesIO(module.read_archive(ROOT/'garment-duration-four.zip.xz'))) as z:
   files={n:z.read(n) for n in z.namelist() if not n.startswith('native-cache/sessions/cpu-garment-soft/')}
  r=json.loads(files['receipt.json']);r.pop('relaxation_study')
  r.update(experiment='actual-garment-native-clear-warm-sewing-v1-fixed-material-study',fixed_material_study='stiff',source_sha256=module.SOURCE_SHA256,case_names=['stiff'],case_normalized_young={'stiff':2000.},cases={'stiff':r['cases']['stiff']},native_input_admission={'stiff':r['native_input_admission']['stiff']})
  cls.original=files;cls.receipt=r;cls.raw=resign(files,r).read()
 def audit(self,stream,verify=True):
  profile={'synthetic-stiff':(hashlib.sha256(self.raw).hexdigest(),4,'stiff',0)}
  with patch.dict(module.PROFILES,profile,clear=True):return module.audit(stream,profile='synthetic-stiff',verify_archive_hash=verify)
 def test_synthetic_envelope_replays_but_cannot_claim_original_pair(self):
  r=self.audit(io.BytesIO(self.raw))
  self.assertTrue(r['fixed_material_bounded_motion_complete']);self.assertFalse(r['original_timed_out_serial_pair_completed'])
  self.assertEqual(r['case']['raw_frames'],181)
  self.assertTrue(all(c['all_available_frames_identical'] for c in r['duration_reference_comparisons'].values()))
  self.assertEqual(r['case']['construction']['overall']['maximum_absolute_strain'],r['case']['metrics']['final_maximum_absolute_edge_strain'])
 def test_old_pairs_and_unregistered_profiles_refuse(self):
  for path in ['garment-material-one.zip','garment-duration-one.zip.xz','garment-duration-four.zip.xz']:
   with self.subTest(path=path),self.assertRaises(ValueError):self.audit(ROOT/path,False)
  with self.assertRaises(ValueError):module.audit(io.BytesIO(self.raw),profile='unregistered')
 def test_resigned_controls_outputs_and_extra_session_refuse(self):
  prefix='native-cache/sessions/cpu-garment-stiff/session/'
  for mode in ['material','pair-flag','source','rest','duration','last-frame','timing','nonfinite','namespace','invocation','cleanup','timeout']:
   files=self.original.copy();r=json.loads(json.dumps(self.receipt))
   if mode=='material':r['case_normalized_young']['stiff']=500.
   if mode=='pair-flag':r['relaxation_study']=True
   if mode=='source':r['source_sha256']['garment_native_probe.py']='forged'
   if mode=='rest':files[prefix+'bin/rest_vert.bin']=bytes(len(files[prefix+'bin/rest_vert.bin']))
   if mode=='duration':files[prefix+'param.toml']=files[prefix+'param.toml'].replace(b'frames = 180',b'frames = 60')
   if mode=='last-frame':del files[prefix+'output/vert_180.bin']
   if mode=='timing':files[prefix+'output/data/frame_to_time.out']=b'0 0\n'
   if mode=='nonfinite':files[prefix+'output/vert_180.bin']=b'\x00\x00\xc0\x7f'+files[prefix+'output/vert_180.bin'][4:]
   if mode=='namespace':files['native-cache/sessions/cpu-garment-soft/session/command.sh']=files[prefix+'command.sh']
   if mode=='invocation':files[prefix+'command.sh']+=b' --disable-contact'
   if mode=='cleanup':
    supervisor=json.loads(files['supervisor.json']);supervisor['remaining_children']=1;files['supervisor.json']=json.dumps(supervisor).encode()
   if mode=='timeout':r['status']='timed_out'
   stream=resign(files,r)
   with self.subTest(mode=mode),self.assertRaises(ValueError):self.audit(stream,False)
 def test_finite_trajectory_difference_is_reported_without_hiding_it(self):
  files=self.original.copy();r=json.loads(json.dumps(self.receipt));prefix='native-cache/sessions/cpu-garment-stiff/session/output/'
  values=list(struct.unpack('<7059f',files[prefix+'vert_180.bin']));values[0]+=.0001
  files[prefix+'vert_180.bin']=struct.pack('<7059f',*values)
  initial=struct.unpack('<7059f',files[prefix+'vert_0.bin']);maximum=0.
  for i in range(181):
   frame=struct.unpack('<7059f',files[prefix+f'vert_{i}.bin'])
   maximum=max(maximum,max(math.dist(initial[j:j+3],frame[j:j+3]) for j in range(0,len(frame),3)))
  r['cases']['stiff']['maximum_displacement_m']=maximum;stream=resign(files,r)
  with self.assertRaises(ValueError):self.audit(stream)
  stream.seek(0);result=self.audit(stream,False)
  self.assertTrue(result['fixed_material_bounded_motion_complete'])
  self.assertFalse(result['duration_reference_comparisons']['four']['all_available_frames_identical'])
  self.assertEqual(result['duration_reference_comparisons']['four']['identical_raw_frames'],180)
