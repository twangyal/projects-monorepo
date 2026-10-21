"""Exact replay of the two official native bending-control archives."""
import json,unittest
from pathlib import Path
from garment_bending_comparison import compare
class RetainedBendingPair(unittest.TestCase):
 def test_actual_complete_pair_reproduces_derived_receipt(self):
  root=Path(__file__).with_name('results');x=compare(root/'garment-bending-reference.zip',root/'garment-bending-zero.zip')
  self.assertEqual(x,json.loads((root/'garment-bending-comparison.json').read_text()))
  self.assertEqual(x['input_comparison']['changed_native_arrays'],['param/tri-bend.bin'])
  self.assertTrue(x['input_comparison']['identical_scene_and_session_metadata'])
  self.assertEqual(x['saved_trajectory_difference']['saved_frames'],181)
  self.assertEqual(x['saved_trajectory_difference']['vertices_per_frame'],2353)
  for mode,bend in [('reference',20.),('zero',0.)]:
   self.assertEqual(x[mode]['normalized_bend'],bend)
   self.assertEqual(x[mode]['bending_study'],mode)
   self.assertEqual(x[mode]['case']['raw_frames'],181)
   self.assertTrue(x[mode]['case']['completed_case'])
   self.assertEqual(x[mode]['supervisor']['remaining_children'],0)
