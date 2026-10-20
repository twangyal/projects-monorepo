"""Replay official half-step archives; freeze observations, not acceptance tolerances."""
import json,unittest
from pathlib import Path
import garment_fixed_material_audit as m
ROOT=Path(__file__).with_name('results')
class HalfStepEvidence(unittest.TestCase):
 def test_complete_official_evidence_and_recorded_reports(self):
  for name,peak,final_rms in [('soft',.4091216498888155,9.228785484422807e-05),('stiff',.26334695106409,.0008888550118000792)]:
   with self.subTest(material=name):
    r=m.audit(ROOT/f'garment-half-{name}.zip',profile=f'four-{name}',protocol='half-step')
    self.assertEqual(r,json.loads((ROOT/f'garment-half-{name}-replay.json').read_text()))
    self.assertEqual(r['native_files_verified'],463);self.assertEqual(r['case']['raw_frames'],181)
    self.assertTrue(r['fixed_material_bounded_motion_complete']);self.assertFalse(r['original_timed_out_serial_pair_completed'])
    self.assertEqual(r['supervisor']['remaining_children'],0)
    self.assertEqual(r['duration_reference_comparisons']['four']['identical_raw_frames'],1)
    self.assertEqual(r['reference_trajectory']['identical_coordinate_frames'],1)
    self.assertAlmostEqual(r['reference_trajectory']['final_vertex_rms_difference_m'],final_rms,places=14)
    self.assertAlmostEqual(r['case']['principal_strain']['overall']['maximum_extension'],peak,places=14)
    self.assertEqual(r['case']['principal_strain']['worst_triangles'][0]['native_triangle'],3091)
    self.assertEqual(r['case']['endpoint']['cloth_body_surface']['violations'],0)
    self.assertEqual(r['case']['endpoint']['collar_shirt_surface']['violations'],0)
 def test_registry_and_protocol_cannot_be_swapped(self):
  for name in ['soft','stiff']:
   for protocol,profile in [('fixed-material',f'four-{name}'),('half-step','four-'+('stiff' if name=='soft' else 'soft'))]:
    with self.subTest(material=name,protocol=protocol),self.assertRaises(ValueError):
     m.audit(ROOT/f'garment-half-{name}.zip',profile=profile,protocol=protocol)
  with self.assertRaises(ValueError):m.audit(ROOT/'garment-fixed-four-soft.zip',profile='four-soft',protocol='half-step')
