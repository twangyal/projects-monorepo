import math,unittest
from garment_construction_diagnostics import construction_diagnostics
class ConstructionDiagnostics(unittest.TestCase):
 def fixture(self):
  return {'initial':[[0,0,0],[1,0,0],[0,1,0],[0,-1,0]],'rest':[[0,0,0],[1,0,0],[0,1,0],[0,-1,0]],'faces':[[0,1,2],[0,3,1]],'face_source':[{'part':'front','render_triangle':4},{'part':'back','render_triangle':7}],'stitch_indices':[[2,2,2,3,3,3]]}
 def test_shared_edges_and_signed_strain_remain_locatable(self):
  d=self.fixture();frame=[[0,0,0],[1.5,0,0],[0,1,0],[0,-1,0]];r=construction_diagnostics(d,frame)
  self.assertEqual(r['unique_intrinsic_edges'],5)
  self.assertEqual(r['parts']['front']['edge_count'],3)
  self.assertEqual(r['parts']['back']['edge_count'],3)
  self.assertEqual(r['worst_edges'][0]['vertices'],[0,1])
  self.assertEqual(r['worst_edges'][0]['parts'],['back','front'])
  self.assertEqual(r['worst_edges'][0]['signed_strain'],.5)
  self.assertEqual(r['worst_edges'][0]['source_triangles'],[{'part':'back','render_triangle':7},{'part':'front','render_triangle':4}])
  self.assertEqual(r['stitches']['maximum_gap_m'],2)
  self.assertEqual(r['stitches']['largest_gaps'][0]['endpoint_parts'],[['front'],['back']])
  self.assertEqual(r['stitches']['parts'],{'front':{'stitch_rows':1,'maximum_gap_m':2},'back':{'stitch_rows':1,'maximum_gap_m':2}})
 def test_compression_and_nearest_rank_percentiles(self):
  d=self.fixture();frame=[[0,0,0],[.5,0,0],[0,1,0],[0,-1,0]];r=construction_diagnostics(d,frame)
  self.assertEqual(r['worst_edges'][0]['signed_strain'],-.5)
  self.assertEqual(r['parts']['front']['maximum_compression'],.5)
  self.assertEqual(r['parts']['front']['maximum_extension'],0.)
  self.assertEqual(r['parts']['front']['absolute_strain_p95'],.5)
 def test_reject_incomplete_nonfinite_and_degenerate_inputs(self):
  d=self.fixture()
  for frame in [d['initial'][:-1],[[math.nan,0,0]]+d['initial'][1:]]:
   with self.assertRaises(ValueError):construction_diagnostics(d,frame)
  d['rest'][1]=d['rest'][0]
  with self.assertRaises(ValueError):construction_diagnostics(d,d['initial'])
 def test_frozen_pair_localizes_the_existing_peak_without_changing_it(self):
  import gzip,hashlib,io,json,struct,zipfile
  from pathlib import Path
  from garment_archive_storage import read_archive
  root=Path(__file__).with_name('results');raw=read_archive(root/'garment-duration-four.zip.xz')
  self.assertEqual(hashlib.sha256(raw).hexdigest(),'af0c6e074e4625bdcb33d9180411ad1a463ba316dd2e96e1e06c1c2c1933289c')
  retained=json.loads((root/'garment-construction-three-second.json').read_text())
  with zipfile.ZipFile(io.BytesIO(raw)) as z:
   inputs=json.loads(gzip.decompress(z.read('native-blueprint.json.gz')))
   for name in ['soft','stiff']:
    values=struct.unpack('<7059f',z.read(f'native-cache/sessions/cpu-garment-{name}/session/output/vert_180.bin'));frame=[list(values[i:i+3]) for i in range(0,len(values),3)]
    result=construction_diagnostics(inputs,frame)
    self.assertEqual(result,retained['cases'][name])
    self.assertEqual(result['worst_edges'][0]['vertices'],[561,571])
    self.assertEqual(result['worst_edges'][0]['parts'],['back','front'])
    self.assertEqual(result['parts']['front']['edge_count'],2965)
    self.assertEqual(result['parts']['back']['edge_count'],3072)
