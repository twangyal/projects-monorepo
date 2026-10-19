import gzip,unittest
from pathlib import Path
from garment_mesh_patch_evidence import replay_diff
from garment_mesh_order_patch import SOURCE_PATH
class PatchEvidence(unittest.TestCase):
 def fixture(self):
  root=Path(__file__).parent
  before=gzip.decompress((root/'results/mesh-order-base.rs.gz').read_bytes())
  patch=(root/'patches/canonical_mesh_order.patch').read_bytes()
  diff=(f'diff --git a/{SOURCE_PATH} b/{SOURCE_PATH}\nindex original..patched 100644\n').encode()+patch
  return before,diff
 def test_independent_reconstruction_and_unknown_context_refusal(self):
  before,diff=self.fixture();after=replay_diff(before,diff)
  import hashlib
  self.assertEqual(hashlib.sha256(after).hexdigest(),'29ba8fa8ef9e45a4ba8c323d644aed557939afab1f0d74bbb4bc8aa93f89be50')
  for changed in [diff.replace(b'a/crates/',b'a/other/'),diff.replace(b'-use std::collections',b'-incorrect context'),diff+b'diff --git a/other b/other\n',diff.replace(b'@@ -8 +8 @@',b'@@ -8,2 +8 @@'),diff.replace(b'@@ -8 +8 @@',b'@@ -8 +9 @@')]:
   self.assertNotEqual(changed,diff)
   with self.subTest(changed=changed[-30:]),self.assertRaises(ValueError):replay_diff(before,changed)
 def test_complete_provenance_wrapper_refuses_changed_records(self):
  import io,json,tempfile,zipfile
  from garment_mesh_order_patch import apply
  from garment_mesh_patch_evidence import verify_research_patch
  before,diff=self.fixture()
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);source=root/SOURCE_PATH;source.parent.mkdir(parents=True);source.write_bytes(before);out=root/'report';apply(root,out)
   files={p.name:p.read_bytes() for p in out.iterdir()}
  files['upstream-research.diff']=diff
  files['native-binary-sha256.txt']=b'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  /home/runner/work/projects-monorepo/projects-monorepo/upstream/target/cpu/release/ppf-contact-solver\n'
  def verify(items):
   stream=io.BytesIO()
   with zipfile.ZipFile(stream,'w') as z:
    for n,v in items.items():z.writestr(n,v)
   with zipfile.ZipFile(io.BytesIO(stream.getvalue())) as z:return verify_research_patch(z)
  self.assertEqual(verify(files)['patched_mesh_sha256'],'29ba8fa8ef9e45a4ba8c323d644aed557939afab1f0d74bbb4bc8aa93f89be50')
  for mode in ['receipt','base','patched','patch','diff','executable','missing']:
   changed=files.copy()
   if mode=='receipt':
    r=json.loads(changed['research-patch.json']);r['experiment']='other';changed['research-patch.json']=json.dumps(r).encode()
   if mode in ['base','patched']:changed[mode+'-mesh.rs']+=b'\n'
   if mode=='patch':changed['canonical_mesh_order.patch']+=b'\n'
   if mode=='diff':changed['upstream-research.diff']=diff.replace(b'-use std::collections',b'-incorrect context')
   if mode=='executable':changed['native-binary-sha256.txt']=b'not measured'
   if mode=='missing':del changed['patched-mesh.rs']
   with self.subTest(mode=mode),self.assertRaises(ValueError):verify(changed)
