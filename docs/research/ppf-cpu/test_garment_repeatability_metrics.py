import math,unittest
import importlib.util
class RepeatabilityMetrics(unittest.TestCase):
 def comparison(self):
  spec=importlib.util.find_spec('garment_repeatability_audit');self.assertIsNotNone(spec,'Whole-trajectory comparison is missing.')
  import garment_repeatability_audit as module
  return module.trajectory_comparison
 def test_known_whole_trajectory_difference_and_identical_control(self):
  compare=self.comparison();a=[[[0,0,0],[0,0,0]],[[0,0,0],[0,0,0]]];b=[a[0],[[3,0,0],[0,4,0]]]
  r=compare(a,b);self.assertEqual(r['maximum_vertex_difference_m'],4.)
  self.assertAlmostEqual(r['all_saved_vertex_rms_difference_m'],2.5)
  self.assertAlmostEqual(r['final_vertex_rms_difference_m'],math.sqrt(12.5))
  self.assertEqual(r['identical_coordinate_frames'],1)
  zero=compare(a,a);self.assertEqual(zero['maximum_vertex_difference_m'],0.);self.assertEqual(zero['identical_coordinate_frames'],2)
 def test_missing_frames_vertices_or_nonfinite_data_cannot_silently_zip(self):
  compare=self.comparison();a=[[[0,0,0]],[[1,0,0]]]
  for b in [a[:1],[a[0],[]],[a[0],[[float('nan'),0,0]]],[a[0],[[0,0]]]]:
   with self.assertRaises(ValueError):compare(a,b)
