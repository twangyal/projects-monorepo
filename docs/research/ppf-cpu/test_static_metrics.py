import math
import unittest
from static_metrics import measure,admit

def frames(descent):
    return [[[i*.001,1.03-descent*f/12,0.] for i in range(25)] for f in range(13)]

class PlaneOracle(unittest.TestCase):
    def test_contact_control_measurements_match_an_independent_plane_calculation(self):
        held=measure(frames(.029));through=measure(frames(.2));admit(held,through)
        self.assertEqual(held['wrong_side'],0);self.assertEqual(through['wrong_side'],275)
        self.assertEqual(through['first_wrong_side'],2);self.assertAlmostEqual(through['min_clearance'],-.17)
        self.assertAlmostEqual(through['descent'],.2);self.assertEqual(held['covered_vertex_frames'],325)
    def test_frozen_or_unreached_contacts_and_ineffective_controls_fail(self):
        held=measure(frames(.029));through=measure(frames(.2))
        for a,b in [(measure(frames(0)),through),(held,held),(through,through)]:
            with self.assertRaises(ValueError):admit(a,b)
    def test_missing_nonfinite_or_uncovered_frame_data_never_becomes_a_contact_pass(self):
        for mutate in [lambda x:x.pop(),lambda x:x[3].pop(),lambda x:x[2][0].__setitem__(0,.3),lambda x:x[4][1].__setitem__(1,math.nan),lambda x:x[5][2].__setitem__(2,math.inf),lambda x:x[0][0].__setitem__(1,1.01)]:
            value=frames(.029);mutate(value)
            with self.assertRaises(ValueError):measure(value)
if __name__=='__main__':unittest.main()
