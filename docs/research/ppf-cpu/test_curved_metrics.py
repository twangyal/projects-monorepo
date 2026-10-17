import math
import unittest
from curved_metrics import body_planes, clip_triangle, measure, admit
from curved_geometry import sphere, sheet

CUBE=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]
FACES=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]]

def frames(descent,curve=0):
    vertices,_=sheet()
    return [[[x,1.13-descent*f/18-curve*(x*x+z*z)/.0288*f/18,z] for x,y,z in vertices] for f in range(19)]

class CurvedOracle(unittest.TestCase):
    def test_triangle_interior_crossing_is_detected_when_all_vertices_are_outside(self):
        planes=body_planes(CUBE,FACES)
        tri=[[-2,0,0],[2,0,0],[0,2,0]]
        self.assertTrue(all(max(sum(n[i]*v[i] for i in range(3))-d for n,d in planes)>0 for v in tri))
        self.assertTrue(clip_triangle(tri,planes))
        self.assertFalse(clip_triangle([[2,0,0],[2,1,0],[2,0,1]],planes))
        self.assertFalse(clip_triangle([[-1,0,0],[-1,.5,0],[-1,0,.5]],planes))
        self.assertTrue(clip_triangle([[0,0,0],[.5,0,0],[0,.5,0]],planes))
    def test_body_refuses_open_inverted_degenerate_and_nonconvex_meshes(self):
        for faces in [FACES[:-1],[f[::-1] for f in FACES],FACES+[[0,0,0]],FACES+[FACES[0]]]:
            with self.assertRaises(ValueError):body_planes(CUBE,faces)
        bad=[v[:] for v in CUBE];bad[6]=[0,0,0]
        with self.assertRaises(ValueError):body_planes(bad,FACES)
    def test_frozen_meshes_are_closed_convex_and_exactly_sized(self):
        vertices,faces=sphere();planes=body_planes(vertices,faces)
        self.assertEqual((len(vertices),len(faces),len(planes)),(114,224,224))
        self.assertAlmostEqual(max(v[1] for v in vertices),1.1)
        self.assertAlmostEqual(min(v[1] for v in vertices),.7)
        upper,tri=sheet();self.assertEqual((len(upper),len(tri)),(81,128))
        self.assertTrue(all(v[1]==1.13 for v in upper))
        self.assertFalse(any(clip_triangle([upper[i] for i in f],planes) for f in tri))
    def test_actual_measurements_and_admission_refuse_frozen_flat_or_ineffective_controls(self):
        vertices,faces=sphere();planes=body_planes(vertices,faces);_,tri=sheet()
        # Synthetic held sheet above the body, with a nonplanar skirt; control crosses it.
        held=measure(frames(.025,.01),tri,planes);control=measure(frames(.44),tri,planes)
        admit(held,control)
        self.assertEqual(held['penetrating_triangle_frames'],0)
        self.assertGreater(control['penetrating_triangle_frames'],0)
        self.assertGreater(control['inside_vertex_frames'],0)
        self.assertAlmostEqual(control['mean_descent'],.44)
        for failed in [measure(frames(0),tri,planes),measure(frames(.025),tri,planes),control]:
            with self.assertRaises(ValueError):admit(failed,control)
        with self.assertRaises(ValueError):admit(held,held)
    def test_missing_nonfinite_or_wrong_rest_data_fail_closed(self):
        vertices,faces=sphere();planes=body_planes(vertices,faces);_,tri=sheet()
        for change in [lambda x:x.pop(),lambda x:x[1].pop(),lambda x:x[3][2].__setitem__(0,math.nan),lambda x:x[0][0].__setitem__(1,1.12)]:
            data=frames(.025,.01);change(data)
            with self.assertRaises(ValueError):measure(data,tri,planes)
if __name__=='__main__':unittest.main()
