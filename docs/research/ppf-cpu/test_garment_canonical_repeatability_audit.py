from pathlib import Path
import io,json,unittest,zipfile
from garment_repeatability_audit import audit
ROOT=Path(__file__).with_name('results')
class CanonicalArchive(unittest.TestCase):
 def test_actual_repaired_native_pairs_require_declared_source(self):
  for name in ['one','four']:
   r=audit(ROOT/f'garment-canonical-{name}.zip',profile='canonical-'+name)
   self.assertEqual(r['native_files_verified'],446)
   self.assertTrue(r['identical_native_input_bytes'])
   self.assertEqual(r['source_commit'],'d56b1d61faa95b557fd61274db51c5d619ca367b')
   self.assertEqual(r['research_patch']['experiment'],'canonical-derived-mesh-order-v1')
   self.assertEqual(r['trajectory']['saved_frames'],61)
   self.assertEqual(r['identical_raw_frames'],61)
   self.assertEqual(r['trajectory']['maximum_vertex_difference_m'],0.)
   self.assertEqual({len(v) for v in r['raw_frame_sha256'].values()},{61})
 def test_original_archive_cannot_masquerade_as_repaired_source(self):
  with self.assertRaises(ValueError):audit(ROOT/'garment-repeatability-one.zip',profile='canonical-one',verify_archive_hash=False)
 def test_resigned_patch_provenance_changes_are_refused(self):
  with zipfile.ZipFile(ROOT/'garment-canonical-one.zip') as z:original={n:z.read(n) for n in z.namelist()}
  for mode in ['receipt','source','diff','executable','missing']:
   files=original.copy()
   if mode=='receipt':
    r=json.loads(files['research-patch.json']);r['experiment']='other';files['research-patch.json']=json.dumps(r).encode()
   if mode=='source':files['patched-mesh.rs']+=b'\n'
   if mode=='diff':files['upstream-research.diff']+=b'diff --git a/other b/other\n'
   if mode=='executable':files['native-binary-sha256.txt']=b'not measured'
   if mode=='missing':del files['research-patch.json']
   stream=io.BytesIO()
   with zipfile.ZipFile(stream,'w') as z:
    for n,v in files.items():z.writestr(n,v)
   stream.seek(0)
   with self.subTest(mode=mode),self.assertRaises(ValueError):audit(stream,profile='canonical-one',verify_archive_hash=False)
