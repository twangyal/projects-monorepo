"""Official four-job fixed-material evidence, separate from synthetic checker tests."""
import unittest
from pathlib import Path
import garment_fixed_material_audit as module
ROOT=Path(__file__).with_name('results')
class FixedMaterialEvidence(unittest.TestCase):
 def test_official_sessions_replay_and_freeze_observed_comparisons(self):
  self.assertEqual(set(module.PROFILES),{'one-soft','one-stiff','four-soft','four-stiff'})
  results={}
  for profile in module.PROFILES:
   r=module.audit(ROOT/f'garment-fixed-{profile}.zip',profile=profile);results[profile]=r
   self.assertTrue(r['fixed_material_bounded_motion_complete'])
   self.assertFalse(r['original_timed_out_serial_pair_completed'])
   self.assertEqual(r['case']['raw_frames'],181)
   self.assertEqual(r['case']['motion_frames'],180)
   self.assertTrue(all(c['all_available_frames_identical'] for c in r['duration_reference_comparisons'].values()))
   self.assertEqual(len(r['case']['saved_motion_windows']),3)
   self.assertEqual(r['case']['construction']['overall']['maximum_absolute_strain'],r['case']['metrics']['final_maximum_absolute_edge_strain'])
   self.assertEqual(r['supervisor']['remaining_children'],0)
  for name in ['soft','stiff']:
   self.assertEqual(results[f'one-{name}']['raw_frame_sha256'],results[f'four-{name}']['raw_frame_sha256'])
 def test_official_archive_cannot_change_profile_or_material(self):
  for profile,wrong in [('one-stiff','four-stiff'),('one-soft','one-stiff')]:
   with self.assertRaises(ValueError):module.audit(ROOT/f'garment-fixed-{profile}.zip',profile=wrong)
