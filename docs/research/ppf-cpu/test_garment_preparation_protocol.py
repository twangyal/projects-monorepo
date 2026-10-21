import unittest
import garment_native_probe as p
class PreparationProtocol(unittest.TestCase):
 def test_fixed_soft_four_normal_protocol_and_distinct_modes(self):
  env=dict.fromkeys(['RAYON_NUM_THREADS','OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS'],'4')
  good=['clear-warm-sewing',180,'browser-inertia',False,False,False,'soft',False,None]
  for mode in ['reference','smoothed']:
   self.assertEqual(p.preparation_settings(mode,*good,env)['requested_threads'],4)
  for mode in ['',True,'zero',None]:
   with self.assertRaises(ValueError):p.preparation_settings(mode,*good,env)
  for i,v in [(0,'warm-sewing'),(1,60),(2,'captured-density'),(3,True),(4,True),(5,True),(6,'stiff'),(7,True),(8,'reference'),(8,'zero')]:
   changed=good[:];changed[i]=v
   with self.assertRaises(ValueError):p.preparation_settings('smoothed',*changed,env)
  with self.assertRaises(ValueError):p.preparation_settings('smoothed',*good,dict.fromkeys(env,'1'))
