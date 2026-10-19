import unittest
from garment_motion_windows import saved_motion_windows
class MotionWindows(unittest.TestCase):
 def test_each_window_uses_its_own_intervals_and_shared_boundary(self):
  frames=[[[x,0,0]] for x in [0,1,2,4,6,6,6]]
  r=saved_motion_windows(frames,dt=.5,intervals_per_window=2)
  self.assertEqual([w['start_seconds'] for w in r],[0.,1.,2.])
  self.assertEqual([w['end_seconds'] for w in r],[1.,2.,3.])
  self.assertEqual([w['maximum_secant_speed_m_s'] for w in r],[2.,4.,0.])
  self.assertEqual([w['rms_secant_speed_m_s'] for w in r],[2.,4.,0.])
 def test_invalid_and_incomplete_windows_are_refused(self):
  frames=[[[0,0,0]],[[1,0,0]],[[2,0,0]]]
  for dt,n in [(0,2),(float('nan'),2),(.5,True),(.5,0),(.5,3)]:
   with self.assertRaises(ValueError):saved_motion_windows(frames,dt,n)
  for changed in [[[],[],[]],[frames[0],[[float('inf'),0,0]],frames[-1]],[frames[0],[[0,0]],frames[-1]]]:
   with self.assertRaises(ValueError):saved_motion_windows(changed,.5,2)
