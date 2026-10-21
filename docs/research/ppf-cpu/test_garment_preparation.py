import copy,math,unittest
import garment_preparation as m

class Preparation(unittest.TestCase):
 def test_constant_field_and_input_immutability(self):
  faces=[[0,1,2]];directions=[[0.,0.,1.]]*3;snapshot=copy.deepcopy(directions)
  self.assertEqual(m.smooth_directions(faces,directions),directions)
  self.assertEqual(directions,snapshot)
 def test_blended_field_is_unit_and_deterministic(self):
  faces=[[0,1,2],[2,1,3]];directions=[[1.,0.,0.],[0.,1.,0.],[0.,0.,1.],[1.,0.,0.]]
  result=m.smooth_directions(faces,directions)
  self.assertEqual(result,m.smooth_directions(list(reversed(faces)),directions))
  self.assertTrue(all(math.isclose(math.hypot(*v),1.,abs_tol=1e-14) for v in result))
  self.assertNotEqual(result,directions)
 def test_three_self_inclusive_jacobi_passes_and_half_blend_numeric_oracle(self):
  # Independent70-digit Decimal calculation on this four-vertex graph.
  result=m.smooth_directions([[0,1,2],[2,1,3]],[[1.,0.,0.],[0.,1.,0.],[0.,0.,1.],[1.,0.,0.]])
  expected=[[.9274808716669864,.26436644330535515,.26436644330535515],[.42178285553486247,.8618340308662738,.28167592374508685],[.42178285553486247,.28167592374508685,.8618340308662738],[.9274808716669864,.26436644330535515,.26436644330535515]]
  for a,b in zip(result,expected):
   for x,y in zip(a,b):self.assertAlmostEqual(x,y,places=13)
 def test_bad_geometry_and_modes_refuse(self):
  for faces,directions in [([],[[1,0,0]]),([[0,1,3]],[[1,0,0]]*3),([[0,0,1]],[[1,0,0]]*3),([[0,1,2]],[[0,0,0]]*3),([[0,1,2]],[[math.nan,0,1]]*3)]:
   with self.assertRaises(ValueError):m.smooth_directions(faces,directions)
  with self.assertRaises(ValueError):m.rebuild('unknown')
 def test_frozen_candidate_preserves_all_except_initial_and_mass_coefficients(self):
  original,reference,*_=m.rebuild('reference');source,candidate,*_=m.rebuild('smoothed')
  self.assertEqual(source,original)
  self.assertEqual(set(reference),set(candidate))
  changed={k for k in reference if reference[k]!=candidate[k]}
  self.assertEqual(changed,{'initial','face_density'})
  for mode in ['reference','smoothed']:
   _,inputs,wp,cp,layout,mass=m.rebuild(mode)
   self.assertEqual(cp['surface_admission']['violations'],0)
   self.assertEqual(cp['surface_admission']['required_clearance_m'],.006)
   self.assertLess(mass['maximum_source_particle_mass_relative_error'],1e-5)
