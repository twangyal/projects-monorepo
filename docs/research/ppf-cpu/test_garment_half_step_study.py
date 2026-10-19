import unittest
import garment_native_probe as probe
from garment_native_inputs import SESSION
from garment_native_export import verify_export
from test_garment_native_export import buffers
class HalfStepStudy(unittest.TestCase):
 def test_explicit_half_step_changes_only_dt_at_declared_horizon(self):
  self.assertEqual(probe.session_controls(180,half_step_study=True),{**SESSION,'frames':180,'dt':1/240})
  for count in [18,60,179,181,180.,True]:
   with self.assertRaises(ValueError):probe.session_controls(count,half_step_study=True)
  with self.assertRaises(ValueError):probe.session_controls(180,relaxation_study=True,half_step_study=True)
 def test_only_fixed_material_requested_four_controls_are_admitted(self):
  env=dict.fromkeys(['RAYON_NUM_THREADS','OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS'],'4')
  good=['clear-warm-sewing',180,'browser-inertia',False,False,False,'soft']
  self.assertEqual(probe.half_step_settings(*good,env)['requested_threads'],4)
  for i,value in [(0,'warm-sewing'),(1,60),(2,'captured-density'),(3,True),(4,True),(5,True),(6,None),(6,'first')]:
   changed=good[:];changed[i]=value
   with self.assertRaises(ValueError):probe.half_step_settings(*changed,env)
  with self.assertRaises(ValueError):probe.half_step_settings(*good,dict.fromkeys(env,'1'))
 def test_export_requires_explicit_half_step_and_no_other_change(self):
  data,files=buffers();files['param.toml']=files['param.toml'].replace(b'frames = 18',b'frames = 180').replace(b'dt = 0.008333333333333333',b'dt = 0.004166666666666667')
  session={**SESSION,'frames':180,'dt':1/240}
  with self.assertRaises(ValueError):verify_export(files.__getitem__,data,500.,session_parameters=session)
  self.assertTrue(verify_export(files.__getitem__,data,500.,session_parameters=session,half_step_study=True)['native_export_bytes_verified'])
  for changed in [{**session,'dt':1/120},{**session,'dt':1/480},{**session,'frames':60},{**session,'fps':120.},{**session,'disable-contact':True}]:
   with self.assertRaises(ValueError):verify_export(files.__getitem__,data,500.,session_parameters=changed,half_step_study=True)
