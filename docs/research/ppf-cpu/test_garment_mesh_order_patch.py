import gzip,json,tempfile,unittest
from pathlib import Path
class MeshOrderPatch(unittest.TestCase):
 def test_exact_pinned_source_changes_only_map_types(self):
  import garment_mesh_order_patch as module
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);p=root/'crates/ppf-cts-solver/src/mesh.rs';p.parent.mkdir(parents=True)
   before=gzip.decompress(Path(__file__).with_name('results').joinpath('mesh-order-base.rs.gz').read_bytes());p.write_bytes(before)
   r=module.apply(root,root/'report')
   self.assertEqual(p.read_bytes().replace(b'BTreeMap',b'HashMap'),before)
   self.assertEqual(r['patched_mesh_sha256'],'29ba8fa8ef9e45a4ba8c323d644aed557939afab1f0d74bbb4bc8aa93f89be50')
   self.assertEqual(json.loads((root/'report/research-patch.json').read_text()),r)
 def test_unknown_source_is_refused_without_mutation(self):
  import garment_mesh_order_patch as module
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);p=root/'crates/ppf-cts-solver/src/mesh.rs';p.parent.mkdir(parents=True);p.write_text('different source')
   with self.assertRaises(ValueError):module.apply(root,root/'report')
   self.assertEqual(p.read_text(),'different source')
