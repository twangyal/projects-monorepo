"""Replay registered official startup-preparation archives and the derived pair."""
import json,unittest
from pathlib import Path
from garment_preparation_comparison import compare

class RetainedPreparationPair(unittest.TestCase):
 def test_complete_native_pair_and_derived_receipt_reproduce(self):
  root=Path(__file__).with_name('results')
  result=compare(root/'garment-preparation-reference.zip',root/'garment-preparation-smoothed.zip')
  self.assertEqual(result,json.loads((root/'garment-preparation-comparison.json').read_text()))
  self.assertEqual(result['input_comparison']['changed_native_arrays'],['param/tri-density.bin','vert.bin'])
  self.assertTrue(result['input_comparison']['identical_scene_and_session_metadata'])
  self.assertEqual(result['saved_trajectory_difference']['saved_frames'],181)
  self.assertEqual(result['saved_trajectory_difference']['vertices_per_frame'],2353)
  for mode in ['reference','smoothed']:
   case=result[mode]
   self.assertEqual(case['preparation_study'],mode)
   self.assertEqual(case['case']['raw_frames'],181)
   self.assertTrue(case['case']['completed_case'])
   self.assertEqual(case['supervisor']['remaining_children'],0)
