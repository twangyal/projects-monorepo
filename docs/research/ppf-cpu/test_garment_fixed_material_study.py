import unittest
import garment_native_probe as probe
from garment_native_inputs import CASES

class FixedMaterialStudy(unittest.TestCase):
 def test_exactly_one_declared_material_with_unchanged_coefficient(self):
  for name in CASES:
   self.assertEqual(probe.fixed_material_cases(name),{name:CASES[name]})
  for name in ['',None,'first','500',500,True]:
   with self.assertRaises(ValueError):probe.fixed_material_cases(name)
 def test_fixed_protocol_refuses_conflicting_or_relaxed_controls(self):
  env=dict.fromkeys(['RAYON_NUM_THREADS','OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS'],'1')
  good=['clear-warm-sewing',180,'browser-inertia',False,False,False]
  for threads in ['1','4']:
   settings=probe.fixed_material_settings(*good,dict.fromkeys(env,threads))
   self.assertEqual(settings['requested_threads'],int(threads))
  for i,value in [(0,'warm-sewing'),(1,60),(1,180.),(2,'captured-density'),(3,True),(4,True),(5,True)]:
   changed=good[:];changed[i]=value
   with self.assertRaises(ValueError):probe.fixed_material_settings(*changed,env)
  for altered in [{},{**env,'OMP_NUM_THREADS':'4'}]:
   with self.assertRaises(ValueError):probe.fixed_material_settings(*good,altered)
