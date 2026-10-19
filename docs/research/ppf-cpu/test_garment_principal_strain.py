import math,unittest
import garment_principal_strain as m
class PrincipalStrain(unittest.TestCase):
 def triangle(self):return [[0.,0.,0.],[1.,0.,0.],[0.,1.,0.]]
 def test_rigid_motion_and_rotated_reference_have_unit_stretches(self):
  r=self.triangle();s=[[3.,4.,5.],[3.,5.,5.],[3.,4.,6.]]
  result=m.triangle_strain(r,s)
  self.assertAlmostEqual(result['maximum_stretch'],1)
  self.assertAlmostEqual(result['minimum_stretch'],1)
  self.assertAlmostEqual(result['area_ratio'],1)
  rotated=[[0.,0.,0.],[0.,1.,0.],[0.,0.,1.]]
  self.assertEqual(result,m.triangle_strain(rotated,s))
 def test_known_anisotropic_stretch_and_compression(self):
  r=self.triangle();s=[[0.,0.,0.],[2.,0.,0.],[0.,.5,0.]];result=m.triangle_strain(r,s)
  self.assertAlmostEqual(result['maximum_stretch'],2)
  self.assertAlmostEqual(result['minimum_stretch'],.5)
  self.assertAlmostEqual(result['maximum_extension'],1)
  self.assertAlmostEqual(result['maximum_compression'],.5)
  self.assertAlmostEqual(result['area_ratio'],1)
  conditioned=m.triangle_strain(r,[[0,0,0],[1e8,0,0],[0,1e-8,0]])
  self.assertAlmostEqual(conditioned['maximum_stretch']/1e8,1)
  self.assertAlmostEqual(conditioned['minimum_stretch']/1e-8,1)
  self.assertAlmostEqual(conditioned['area_ratio'],1)
 def test_simple_shear_has_known_singular_values(self):
  result=m.triangle_strain(self.triangle(),[[0.,0.,0.],[1.,0.,0.],[1.,1.,0.]])
  self.assertAlmostEqual(result['maximum_stretch'],(math.sqrt(5)+1)/2)
  self.assertAlmostEqual(result['minimum_stretch'],(math.sqrt(5)-1)/2)
  self.assertAlmostEqual(result['area_ratio'],1)
 def test_triangle_reordering_does_not_change_the_metric(self):
  r=self.triangle();s=[[0.,0.,0.],[2.,0.,0.],[.3,.5,.4]];reference=m.triangle_strain(r,s)
  for order in [[1,2,0],[2,0,1],[0,2,1]]:
   result=m.triangle_strain([r[i] for i in order],[s[i] for i in order])
   for key,value in reference.items():self.assertAlmostEqual(result[key],value)
 def test_rest_area_weighted_percentiles_do_not_count_small_faces_equally(self):
  inputs={'initial':self.triangle()+[[0,0,0],[10,0,0],[0,10,0]],'rest':self.triangle()+[[0,0,0],[10,0,0],[0,10,0]],'faces':[[0,1,2],[3,4,5]],'face_source':[{'part':'front','render_triangle':4},{'part':'front','render_triangle':8}]}
  frame=[[0,0,0],[2,0,0],[0,2,0]]+inputs['rest'][3:];result=m.principal_strain(inputs,frame)
  self.assertEqual(result['overall']['maximum_extension'],1)
  self.assertEqual(result['overall']['rest_area_weighted_absolute_strain_p95'],0)
  self.assertAlmostEqual(result['overall']['rest_area_m2'],50.5)
  self.assertEqual(result['worst_triangles'][0]['native_triangle'],0)
  self.assertEqual(result['worst_triangles'][0]['source'],{'part':'front','render_triangle':4})
 def test_collapsed_solved_triangle_is_reported_and_degenerate_rest_refuses(self):
  result=m.triangle_strain(self.triangle(),[[0,0,0]]*3)
  self.assertEqual(result['minimum_stretch'],0)
  self.assertEqual(result['maximum_compression'],1)
  rank_one=m.triangle_strain(self.triangle(),[[0,0,0],[1,0,0],[1,0,0]])
  self.assertAlmostEqual(rank_one['maximum_stretch'],math.sqrt(2))
  self.assertEqual(rank_one['minimum_stretch'],0)
  self.assertEqual(rank_one['area_ratio'],0)
  for bad in [[[0,0,0]]*3,[[0,0,0],[math.nan,0,0],[0,1,0]],[[0,0,0],[1,0,0]]]:
   with self.assertRaises(ValueError):m.triangle_strain(bad,self.triangle())
 def test_surface_reflection_has_no_inversion_sign(self):
  result=m.triangle_strain(self.triangle(),[[0,0,0],[-1,0,0],[0,1,0]])
  self.assertEqual(result['maximum_stretch'],1)
  self.assertEqual(result['minimum_stretch'],1)
  self.assertEqual(result['area_ratio'],1)
 def test_mesh_and_source_admission_refuse_incomplete_inputs(self):
  inputs={'initial':self.triangle(),'rest':self.triangle(),'faces':[[0,1,2]],'face_source':[{'part':'front','render_triangle':0}]}
  with self.assertRaises(ValueError):m.principal_strain(inputs,self.triangle()[:-1])
  inputs['faces']=[[0,1,3]]
  with self.assertRaises(ValueError):m.principal_strain(inputs,self.triangle())
  inputs['faces']=[[0,1,2]];inputs['face_source']=[{'part':'front','render_triangle':True}]
  with self.assertRaises(ValueError):m.principal_strain(inputs,self.triangle())
 def test_retained_native_metrics_reproduce_exactly(self):
  import gzip,hashlib,io,json,struct,zipfile
  from pathlib import Path
  from garment_fixed_material_audit import PROFILES
  root=Path(__file__).with_name('results')
  for name in ['soft','stiff']:
   raw=(root/f'garment-fixed-one-{name}.zip').read_bytes()
   self.assertEqual(hashlib.sha256(raw).hexdigest(),PROFILES['one-'+name][0])
   with zipfile.ZipFile(io.BytesIO(raw)) as z:
    inputs=json.loads(gzip.decompress(z.read('native-blueprint.json.gz')))
    values=struct.unpack('<7059f',z.read(f'native-cache/sessions/cpu-garment-{name}/session/output/vert_180.bin'))
    frame=[list(values[i:i+3]) for i in range(0,len(values),3)]
   result=m.principal_strain(inputs,frame);retained=json.loads((root/f'garment-principal-{name}.json').read_text())
   self.assertEqual(result,retained['principal_strain'])
   self.assertGreater(result['overall']['maximum_extension'],retained['edge_maximum_absolute_strain'])
   self.assertEqual(result['worst_triangles'][0]['native_triangle'],3091)
   self.assertEqual(result['overall']['zero_area_solved_triangles'],0)
