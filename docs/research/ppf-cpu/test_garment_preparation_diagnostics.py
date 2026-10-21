import json,unittest
from pathlib import Path
from garment_preparation_diagnostics import diagnose
class StartupDiagnostics(unittest.TestCase):
 def test_stage_receipt_reproduces_and_preserves_native_initial_frame(self):
  r=diagnose();p=Path(__file__).with_name('results')/'garment-preparation-stages.json'
  self.assertEqual(r,json.loads(p.read_text()))
  self.assertEqual(len(r['stages']),8)
  warm=r['stages']['browser_warm']['principal_strain']['worst_triangles'][0]
  clear=r['stages']['reference_float32']['principal_strain']['worst_triangles'][0]
  self.assertEqual(warm['native_triangle'],1040);self.assertEqual(clear['native_triangle'],1160)
  self.assertGreater(warm['maximum_extension'],.54);self.assertGreater(clear['maximum_compression'],.47)
  for name in ['reference_float32','smoothed_float32']:
   self.assertEqual([x['native_triangle'] for x in r['stages'][name]['tracked_triangles']],[1040,1160,3091])
