import copy
import unittest
from bending_metrics import strip,measure,admit

def frames(drop=0.):
    rest,_=strip();settled=[[x,-drop*(max(0,x-.01)/.09)**2,z] for x,y,z in rest]
    return [copy.deepcopy(rest)]+[copy.deepcopy(settled) for _ in range(400)]
class BendingMetrics(unittest.TestCase):
    def test_tip_clamp_and_rest_zero(self):
        m=measure(frames(.001),strip()[0]);self.assertAlmostEqual(m['tip_descent_m'],.001);self.assertEqual(m['clamp_drift_m'],0)
        self.assertEqual(measure(frames(),strip()[0])['tip_descent_m'],0)
    def test_edge_stretch_and_clamp_drift(self):
        f=frames();f[100][43][0]+=.01;self.assertGreater(measure(f,strip()[0])['max_edge_strain'],.5)
        f=frames();f[100][0][1]=.001;self.assertAlmostEqual(measure(f,strip()[0])['clamp_drift_m'],.001)
    def test_motion_not_hidden_by_equal_last_frames(self):
        f=frames();f[-10][40][1]=.001;self.assertGreater(measure(f,strip()[0])['final_window_step_m'],.0009)
    def test_missing_nonfinite_wrong_rest_refused(self):
        for f,rest in [(frames()[:-1],strip()[0]),(frames(),strip()[0][:-1])]:
            with self.assertRaises(ValueError):measure(f,rest)
        f=frames();f[80][40][0]=float('nan')
        with self.assertRaises(ValueError):measure(f,strip()[0])
    def test_admission_refuses_unsettled_stretch_and_reversed_response(self):
        base={'clamp_drift_m':0.,'final_window_step_m':0.,'max_edge_strain':.001}
        cases={'soft':dict(base,tip_descent_m=.08),'stiff':dict(base,tip_descent_m=.01)};admit(cases)
        for name,key,value in [('soft','final_window_step_m',.001),('stiff','max_edge_strain',.05),('stiff','tip_descent_m',.08)]:
            bad=copy.deepcopy(cases);bad[name][key]=value
            with self.assertRaises(ValueError):admit(bad)
