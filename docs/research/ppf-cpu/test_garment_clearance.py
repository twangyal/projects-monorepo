import copy,gzip,json,unittest
from pathlib import Path
from garment_native_inputs import load_inputs
from garment_warm_start import prepare,load_warm_start
from garment_sewing_layout import sewing_layout
from garment_clearance import triangle_distance_squared,surface_clearance,outward_preparation
ROOT=Path(__file__).with_name('results')
class TriangleClearance(unittest.TestCase):
 def test_face_interiors_edges_intersection_and_coplanar_contact(self):
  a=[(0.,0.,0.),(1.,0.,0.),(0.,1.,0.)]
  for b,expected in [([(0.,0.,.2),(1.,0.,.2),(0.,1.,.2)],.04),([(.2,.2,-1.),(.2,.2,1.),(.3,.3,1.)],0.),([(.2,.2,0.),(.4,.2,0.),(.2,.4,0.)],0.),([(2.,0.,0.),(3.,0.,0.),(2.,1.,0.)],1.)]:
   self.assertAlmostEqual(triangle_distance_squared(a,b),expected)
   self.assertAlmostEqual(triangle_distance_squared(b,a),expected)
 def test_interior_edge_edge_minimum(self):
  a=[(-1,0,0),(1,0,0),(0,-.1,0)];b=[(0,-1,.2),(0,1,.2),(0,0,1)]
  self.assertAlmostEqual(triangle_distance_squared(a,b),.04)
 def test_frozen_warm_pose_fails_surface_clearance_before_any_motion(self):
  original=load_inputs(ROOT);warm,_=prepare(original,load_warm_start(ROOT),ROOT);inputs,_=sewing_layout(warm)
  result=surface_clearance(inputs,.0035)
  self.assertGreater(result['violations'],0)
  self.assertLess(result['minimum_separation_m'],.0035)
 def test_outward_preparation_preserves_construction_and_clears_actual_surfaces(self):
  original=load_inputs(ROOT);warm,_=prepare(original,load_warm_start(ROOT),ROOT);before=copy.deepcopy(warm)
  body=json.loads(gzip.decompress((ROOT/'garment-first.json.gz').read_bytes()))['packet']['body']
  candidate,parameters=outward_preparation(warm,body);candidate,_=sewing_layout(candidate)
  self.assertEqual(warm,before)
  self.assertEqual({k:v for k,v in candidate.items() if k!='initial'},{k:v for k,v in before.items() if k!='initial'})
  self.assertTrue(parameters['outward_offset_m']>0)
  self.assertEqual(surface_clearance(candidate,.006)['violations'],0)
 def test_empty_mesh_is_refused_instead_of_reporting_clearance(self):
  with self.assertRaises(ValueError):surface_clearance({'initial':[],'faces':[],'body_vertices':[],'body_faces':[]},.006)
 def test_cell_boundary_and_negative_coordinates_match_exhaustive_distance(self):
  a=[(-.021,-.01,0.),(-.001,-.01,0.),(-.021,.01,0.)];b=[(-.019,-.009,.002),(.001,-.009,.002),(-.019,.011,.002)]
  r=surface_clearance({'initial':a,'faces':[[0,1,2]],'body_vertices':b,'body_faces':[[0,1,2]]},.003)
  self.assertEqual(r['violations'],1)
  self.assertAlmostEqual(r['minimum_separation_m'],.002,places=8)
