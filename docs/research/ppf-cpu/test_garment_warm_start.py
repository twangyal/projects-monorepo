import copy,gzip,json,math,unittest
from pathlib import Path
from garment_native_inputs import load_inputs
from garment_warm_start import prepare,load_warm_start
ROOT=Path(__file__).with_name('results')
class WarmStart(unittest.TestCase):
 def test_growth_endpoint_preserves_original_native_inputs_and_reduces_strain(self):
  source=load_inputs(ROOT);saved=copy.deepcopy(source);result,receipt=prepare(source,load_warm_start(ROOT),ROOT)
  self.assertEqual(source,saved)
  for key in source:
   if key!='initial':self.assertEqual(result[key],source[key],key)
  self.assertLess(receipt['maximum_absolute_edge_strain'],.5)
  self.assertGreater(receipt['maximum_absolute_edge_strain'],.1)
  self.assertEqual(receipt['prepared_source_particles'],2331)
  self.assertEqual(receipt['growth_frames'],45)
 def test_wrong_source_controls_geometry_and_provenance_are_refused(self):
  source=load_inputs(ROOT);warm=load_warm_start(ROOT)
  for mode in ['rest','frames','nan','missing','source']:
   changed=copy.deepcopy(warm)
   if mode=='rest':changed['packet']['source_packet']['constraints'][0]['rest_m']*=2
   if mode=='frames':changed['packet']['preparation']['frames']=44
   if mode=='nan':changed['packet']['positions_m'][0]=math.nan
   if mode=='missing':changed['packet']['positions_m'].pop()
   if mode=='source':changed['source_sha256']['src/garment-drape.ts']='0'*64
   with self.subTest(mode=mode),self.assertRaises(ValueError):prepare(source,changed,ROOT)
