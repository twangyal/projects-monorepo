import copy,math,unittest
from garment_motion import measure

class GarmentMotion(unittest.TestCase):
    def source(self):return {'initial':[[0.,0.,0.],[1.,0.,0.],[0.,1.,0.]],'rest':[[0.,0.,0.],[1.,0.,0.],[0.,1.,0.]],'faces':[[0,1,2]],'stitch_indices':[[0,0,0,1,1,1]]}
    def test_rigid_motion_has_no_membrane_strain_and_retains_seam_distance(self):
        s=self.source();frames=[s['initial'],[[x+.25,y-.1,z] for x,y,z in s['initial']]];r=measure(s,frames)
        self.assertAlmostEqual(r['maximum_vertex_displacement_m'],math.hypot(.25,.1))
        self.assertAlmostEqual(r['maximum_saved_absolute_edge_strain'],0.)
        self.assertEqual(r['final_maximum_stitch_gap_m'],1.)
        self.assertEqual(r['saved_frames'],2)
    def test_rest_reference_and_transient_strain_are_not_replaced_by_initial_or_final_shape(self):
        s=self.source();s['initial'][1][0]=1.5
        r=measure(s,[s['initial'],[[0.,0.,0.],[2.,0.,0.],[0.,1.,0.]],s['rest']])
        self.assertAlmostEqual(r['initial_maximum_absolute_edge_strain'],.5)
        self.assertAlmostEqual(r['maximum_saved_absolute_edge_strain'],1.)
        self.assertEqual(r['final_maximum_absolute_edge_strain'],0.)
        self.assertEqual(r['initial_maximum_stitch_gap_m'],1.5)
    def test_missing_nonfinite_misindexed_and_wrong_initial_frames_refuse(self):
        s=self.source()
        for frames in [[],[s['initial']],[s['initial'],[[0.,0.,0.]]],[s['initial'],[[float('nan'),0.,0.],[1.,0.,0.],[0.,1.,0.]]],[[[.1,0.,0.],[1.,0.,0.],[0.,1.,0.]],s['initial']]]:
            with self.subTest(frames=frames),self.assertRaises(ValueError):measure(s,frames)
