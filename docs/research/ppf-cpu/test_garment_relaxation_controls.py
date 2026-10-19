import copy,unittest
import garment_native_probe
from garment_native_inputs import SESSION
from garment_native_export import verify_export
from test_garment_native_export import buffers
class RelaxationControls(unittest.TestCase):
 def test_declared_horizon_changes_only_saved_duration(self):
  make=getattr(garment_native_probe,'session_controls',None);self.assertTrue(callable(make),'Explicit bounded horizon control is missing.')
  before=copy.deepcopy(SESSION);long=make(60)
  self.assertEqual(long,{**SESSION,'frames':60});self.assertEqual(make(18),SESSION)
  for n in [0,1,59,61,True,60.,'60']:
   with self.assertRaises(ValueError):make(n)
  self.assertEqual(SESSION,before)
 def test_native_export_must_match_declared_longer_session(self):
  data,files=buffers();files['param.toml']=files['param.toml'].replace(b'frames = 18',b'frames = 60')
  with self.assertRaises(ValueError):verify_export(files.__getitem__,data,500.)
  try:result=verify_export(files.__getitem__,data,500.,session_parameters={**SESSION,'frames':60})
  except TypeError:self.fail('Export admission cannot verify the declared longer session.')
  self.assertTrue(result['native_export_bytes_verified'])
  for altered in [{**SESSION,'frames':60,'disable-contact':True},{**SESSION,'frames':60,'dt':1/60},{**SESSION,'frames':61}]:
   with self.assertRaises(ValueError):verify_export(files.__getitem__,data,500.,session_parameters=altered)
