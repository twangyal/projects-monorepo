import math,unittest
from garment_endpoint_diagnostics import secant_speeds
class EndpointKinematics(unittest.TestCase):
 def test_known_unequal_vertex_movement_and_stationary_endpoint(self):
  frames=[[[0,0,0],[0,0,0]],[[.05,0,0],[0,.1,0]]]
  result=secant_speeds(frames,.05)
  self.assertAlmostEqual(result['maximum_m_s'],2.)
  self.assertAlmostEqual(result['rms_m_s'],math.sqrt(2.5))
  self.assertEqual(secant_speeds([frames[0],frames[0]],.05),{'maximum_m_s':0.,'rms_m_s':0.})
 def test_incomplete_or_nonfinite_sampling_refuses(self):
  good=[[[0,0,0]],[[1,0,0]]]
  for frames,dt in [(good,0),(good,float('nan')),([good[0]],.1),([[],[]],.1),([good[0],[]],.1),([good[0],[[float('nan'),0,0]]],.1)]:
   with self.assertRaises(ValueError):secant_speeds(frames,dt)
 def test_pinned_actual_endpoint_reproduces_retained_diagnostics(self):
  import json
  from pathlib import Path
  from garment_endpoint_diagnostics import replay
  root=Path(__file__).with_name('results');result=replay(root/'garment-clearance-native.zip')
  self.assertEqual(result,json.loads((root/'garment-clearance-endpoint.json').read_text()))
  for name,rms in [('soft',.06228712599092317),('stiff',.12363381334689222)]:
   case=result['cases'][name]
   self.assertEqual(case['cloth_body_surface']['violations'],0)
   self.assertEqual(case['collar_shirt_surface']['violations'],0)
   self.assertAlmostEqual(case['last_saved_interval_secant_speed']['rms_m_s'],rms)
