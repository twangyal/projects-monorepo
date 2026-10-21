"""Replay only retained, registered official native gravity artifacts."""
import json,unittest
from pathlib import Path
from garment_gravity_comparison import compare

class RetainedGravityPair(unittest.TestCase):
 def test_complete_native_pair_and_derived_receipt_reproduce(self):
  root=Path(__file__).with_name('results')
  result=compare(root/'garment-gravity-reference.zip',root/'garment-gravity-zero.zip')
  self.assertEqual(result,json.loads((root/'garment-gravity-comparison.json').read_text()))
  self.assertTrue(result['input_comparison']['session_metadata_only_gravity_differs'])
  for mode in ['reference','zero']:
   case=result[mode]
   self.assertEqual(case['gravity_study'],mode)
   self.assertEqual(case['case']['raw_frames'],181)
   self.assertTrue(case['case']['completed_case'])
   self.assertEqual(case['supervisor']['remaining_children'],0)
