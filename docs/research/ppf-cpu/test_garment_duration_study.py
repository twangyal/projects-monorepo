import unittest
from garment_native_inputs import SESSION
import garment_native_probe as probe
from garment_native_export import verify_export
from test_garment_native_export import buffers

class DurationStudy(unittest.TestCase):
 def test_three_seconds_requires_explicit_study(self):
  with self.assertRaises(ValueError):probe.session_controls(180)
  self.assertEqual(probe.session_controls(180,relaxation_study=True),{**SESSION,'frames':180})
  for frames in [18,60,179,181,True,180.0]:
   with self.assertRaises(ValueError):probe.session_controls(frames,relaxation_study=True)
 def test_fixed_study_controls_and_declared_environment(self):
  names=['RAYON_NUM_THREADS','OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS']
  for threads in ['1','4']:
   env=dict.fromkeys(names,threads)
   self.assertEqual(probe.relaxation_settings('clear-warm-sewing',180,'browser-inertia',False,False,env)['requested_threads'],int(threads))
   for args in [('warm-sewing',180,'browser-inertia',False,False),('clear-warm-sewing',60,'browser-inertia',False,False),('clear-warm-sewing',180.0,'browser-inertia',False,False),('clear-warm-sewing',180,'captured-density',False,False),('clear-warm-sewing',180,'browser-inertia',True,False),('clear-warm-sewing',180,'browser-inertia',False,True)]:
    with self.assertRaises(ValueError):probe.relaxation_settings(*args,env)
   for changed in [{},{**env,'OMP_NUM_THREADS':'2'}]:
    with self.assertRaises(ValueError):probe.relaxation_settings('clear-warm-sewing',180,'browser-inertia',False,False,changed)
 def test_export_duration_changes_no_physical_control(self):
  data,files=buffers();files['param.toml']=files['param.toml'].replace(b'frames = 18',b'frames = 180')
  with self.assertRaises(ValueError):verify_export(files.__getitem__,data,500.)
  self.assertTrue(verify_export(files.__getitem__,data,500.,session_parameters={**SESSION,'frames':180})['native_export_bytes_verified'])
  for changed in [{**SESSION,'frames':181},{**SESSION,'frames':180,'dt':1/60},{**SESSION,'frames':180,'disable-contact':True}]:
   with self.assertRaises(ValueError):verify_export(files.__getitem__,data,500.,session_parameters=changed)
