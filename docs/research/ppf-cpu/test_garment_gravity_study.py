"""Explicit gravity-only diagnostic admission; historical protocols stay strict."""
import unittest
import garment_native_probe as probe
from garment_native_inputs import SESSION
from garment_native_export import verify_export
from test_garment_native_export import buffers

class GravityStudy(unittest.TestCase):
 def test_session_changes_only_gravity(self):
  for mode,gravity in [('reference',SESSION['gravity']),('zero',[0.,0.,0.])]:
   self.assertEqual(probe.session_controls(180,gravity_study=mode),{**SESSION,'frames':180,'gravity':gravity})
  for mode in ['',True,'normal',[],{}]:
   with self.assertRaises(ValueError):probe.session_controls(180,gravity_study=mode)
  for count in [18,60,179,181,180.,True]:
   with self.assertRaises(ValueError):probe.session_controls(count,gravity_study='zero')
  for extra in [{'half_step_study':True},{'relaxation_study':True}]:
   with self.assertRaises(ValueError):probe.session_controls(180,gravity_study='zero',**extra)
 def test_fixed_soft_four_thread_protocol(self):
  env=dict.fromkeys(['RAYON_NUM_THREADS','OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS'],'4')
  good=['clear-warm-sewing',180,'browser-inertia',False,False,False,'soft',False]
  self.assertEqual(probe.gravity_settings(*good,env)['requested_threads'],4)
  for i,value in [(0,'warm-sewing'),(1,60),(2,'captured-density'),(3,True),(4,True),(5,True),(6,'stiff'),(6,None),(7,True)]:
   changed=good[:];changed[i]=value
   with self.assertRaises(ValueError):probe.gravity_settings(*changed,env)
  with self.assertRaises(ValueError):probe.gravity_settings(*good,dict.fromkeys(env,'1'))
 def test_export_admits_zero_only_explicitly(self):
  data,files=buffers()
  files['param.toml']=files['param.toml'].replace(b'frames = 18',b'frames = 180').replace(b'-9.8',b'0.0')
  session={**SESSION,'frames':180,'gravity':[0.,0.,0.]}
  with self.assertRaises(ValueError):verify_export(files.__getitem__,data,500.,session_parameters=session)
  self.assertTrue(verify_export(files.__getitem__,data,500.,session_parameters=session,gravity_study='zero')['native_export_bytes_verified'])
  for changed in [{**session,'dt':1/240},{**session,'gravity':[0.,-9.8,0.]},{**session,'frames':60},{**session,'disable-contact':True}]:
   with self.assertRaises(ValueError):verify_export(files.__getitem__,data,500.,session_parameters=changed,gravity_study='zero')
  for mode in ['',True,'normal',[],{}]:
   with self.assertRaises(ValueError):verify_export(files.__getitem__,data,500.,session_parameters=session,gravity_study=mode)
  with self.assertRaises(ValueError):verify_export(files.__getitem__,data,500.,session_parameters=session,gravity_study='zero',half_step_study=True)
 def test_reference_remains_exact_historical_session(self):
  data,files=buffers();files['param.toml']=files['param.toml'].replace(b'frames = 18',b'frames = 180')
  self.assertTrue(verify_export(files.__getitem__,data,500.,session_parameters={**SESSION,'frames':180},gravity_study='reference')['native_export_bytes_verified'])
