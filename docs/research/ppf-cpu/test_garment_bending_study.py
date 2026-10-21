"""Explicit garment bending diagnostic; never a new calibrated fabric preset."""
import unittest
import garment_native_probe as probe
from garment_native_inputs import OBJECT
class GarmentBendingProtocol(unittest.TestCase):
 def test_only_declared_bending_coefficient_changes(self):
  base={**OBJECT,'contact-offset':.0025}
  for mode,value in [('reference',20.),('zero',0.)]:
   self.assertEqual(probe.bending_controls(mode,base),{**base,'bend':value})
  self.assertEqual(base['bend'],20.)
  for mode in ['',True,'soft',20,[],{}]:
   with self.assertRaises(ValueError):probe.bending_controls(mode,base)
 def test_fixed_normal_gravity_reference_pose_and_original_step_only(self):
  env=dict.fromkeys(['RAYON_NUM_THREADS','OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS'],'4')
  good=['clear-warm-sewing',180,'browser-inertia',False,False,False,'soft',False,None,None]
  for mode in ['reference','zero']:
   self.assertEqual(probe.bending_settings(mode,*good,env)['requested_threads'],4)
  for i,value in [(0,'warm-sewing'),(1,60),(1,180.),(2,'captured-density'),(3,True),(4,True),(5,True),(6,'stiff'),(7,True),(8,'reference'),(8,'zero'),(9,'reference'),(9,'smoothed')]:
   changed=good[:];changed[i]=value
   with self.subTest(i=i,value=value),self.assertRaises(ValueError):probe.bending_settings('zero',*changed,env)
  with self.assertRaises(ValueError):probe.bending_settings('zero',*good,dict.fromkeys(env,'1'))
