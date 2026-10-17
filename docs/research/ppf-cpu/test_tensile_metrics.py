import copy
import unittest
from tensile_metrics import strip,measure,admit

def affine(strain):
    v,_=strip()
    return [[x,.2+(y-.2)*(1+strain),z] for x,y,z in v]
def series(strain):return [affine(0)]+[affine(strain) for _ in range(150)]
class TensileMetrics(unittest.TestCase):
    def test_affine_row_mean_and_local_strain(self):
        m=measure(series(.02),strip()[0]);self.assertAlmostEqual(m['extension'],.02);self.assertAlmostEqual(m['max_segment_strain'],.02)
    def test_rest_has_no_offset(self):self.assertAlmostEqual(measure(series(0),strip()[0])['extension'],0.)
    def test_missing_and_nonfinite_and_wrong_rest_refused(self):
        for frames,rest in [(series(.02)[:-1],strip()[0]),(series(.02),strip()[0][:-1])]:
            with self.assertRaises(ValueError):measure(frames,rest)
        frames=series(.02);frames[60][3][0]=float('nan')
        with self.assertRaises(ValueError):measure(frames,strip()[0])
    def test_clamp_drift_detected(self):
        frames=series(.02);frames[80][-1][1]+=.001
        self.assertGreater(measure(frames,strip()[0])['clamp_drift_m'],.0009)
    def test_motion_in_window_detected_even_if_final_two_equal(self):
        frames=series(.02);frames[-10][0][0]+=.001
        self.assertGreater(measure(frames,strip()[0])['final_window_step_m'],.0009)
    def test_admission_refuses_reversed_stiffness_and_movement(self):
        cases={n:measure(series(s),strip()[0]) for n,s in [('soft',.02),('stiff',.005),('density',.02)]}
        for m in cases.values():m['density_max_difference_m']=0.
        admit(cases)
        bad=copy.deepcopy(cases);bad['stiff']['extension']=.03
        with self.assertRaises(ValueError):admit(bad)
        bad=copy.deepcopy(cases);bad['soft']['final_window_step_m']=.001
        with self.assertRaises(ValueError):admit(bad)

class NativeProtocol(unittest.TestCase):
    def test_workflow_uses_probe_success_marker(self):
        from pathlib import Path
        root=Path(__file__).resolve().parents[3]
        workflow=(root/'.github/workflows/clothing-ppf-tensile.yml').read_text()
        self.assertIn("grep -q 'cpu tensile fixture: PASS'",workflow)
