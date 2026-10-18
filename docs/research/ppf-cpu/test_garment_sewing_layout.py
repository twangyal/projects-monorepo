import copy,math,unittest
from pathlib import Path
from garment_native_inputs import load_inputs
from garment_sewing_layout import required_rise,sewing_layout

class SewingLayout(unittest.TestCase):
    def test_separating_translation_is_geometry_driven_and_ignores_off_axis_obstacles(self):
        # Bounds are (minXYZ,maxXYZ). The high body triangle is horizontally disjoint.
        collar=[([0.,0.,0.],[1.,1.,1.])]
        obstacles=[([0.,.5,0.],[1.,2.,1.]),([20.,90.,20.],[21.,100.,21.])]
        self.assertAlmostEqual(required_rise(collar,obstacles,.1),2.1)
        self.assertEqual(required_rise(collar,[([0.,-3.,0.],[1.,-2.,1.])],.1),0.)
    def test_actual_layout_preserves_all_rest_topology_body_and_noncollar_vertices(self):
        data=load_inputs(Path(__file__).with_name('results'));before=copy.deepcopy(data)
        result,receipt=sewing_layout(data)
        self.assertEqual(data,before)
        for key in data:
            if key!='initial':self.assertEqual(result[key],data[key],key)
        rib={i for f,s in zip(data['faces'],data['face_source']) if s['part']=='neckband' for i in f}
        self.assertEqual(len(rib),42)
        self.assertGreater(receipt['collar_rise_m'],0.)
        # Moving the entire collar rigidly in Y must preserve each vertex's relative height.
        rises=[result['initial'][i][1]-data['initial'][i][1] for i in rib]
        self.assertLess(max(rises)-min(rises),1e-12)
        for i in set(range(len(data['initial'])))-rib:self.assertEqual(data['initial'][i],result['initial'][i])
        # An independent geometric certificate: every nearby XZ pair has an actual Y gap.
        def bounds(points):return ([min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)])
        others=[(bounds([result['initial'][i] for i in f]),receipt['cloth_pair_clearance_m']) for f,s in zip(result['faces'],result['face_source']) if s['part']!='neckband']
        others += [(bounds([result['body_vertices'][i] for i in f]),receipt['body_pair_clearance_m']) for f in result['body_faces']]
        for f,s in zip(result['faces'],result['face_source']):
            if s['part']!='neckband':continue
            a,b=bounds([result['initial'][i] for i in f])
            for (c,d),gap in others:
                if all(a[k]<=d[k]+gap and c[k]<=b[k]+gap for k in [0,2]):self.assertGreater(a[1]-d[1],gap)
        self.assertGreater(receipt['cut_pair_gap_m'],receipt['cloth_pair_clearance_m'])
        self.assertEqual((result,receipt),sewing_layout(data))
