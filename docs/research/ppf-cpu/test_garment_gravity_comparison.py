import io,unittest,zipfile
from garment_gravity_comparison import pair_inputs

class GravityPair(unittest.TestCase):
 def archive(self,**changes):
  prefix='native-cache/sessions/cpu-garment-soft/session/'
  files={prefix+'bin/vertices.bin':b'fixed',prefix+'info.toml':b'fixed',prefix+'param.toml':b'gravity = [0.0, -9.8, 0.0]', 'native-binary-sha256.txt':b'a'*64+b'  /same/path'}
  files.update(changes);out=io.BytesIO()
  with zipfile.ZipFile(out,'w') as z:
   for k,v in files.items():z.writestr(k,v)
  out.seek(0);return out
 def test_only_gravity_difference_is_admitted(self):
  prefix='native-cache/sessions/cpu-garment-soft/session/'
  result=pair_inputs(self.archive(),self.archive(**{prefix+'param.toml':b'gravity = [0.0, 0.0, 0.0]'}))
  self.assertEqual(result['identical_native_input_arrays'],1)
 def test_input_metadata_and_executable_confounds_refuse(self):
  prefix='native-cache/sessions/cpu-garment-soft/session/'
  for key,value in [(prefix+'bin/vertices.bin',b'changed'),(prefix+'info.toml',b'changed'),(prefix+'param.toml',b'gravity = [0.0, 0.0, 0.0]\ndt=1'),('native-binary-sha256.txt',b'b'*64+b'  /same/path')]:
   changed={prefix+'param.toml':b'gravity = [0.0, 0.0, 0.0]',key:value}
   with self.subTest(key=key),self.assertRaises(ValueError):pair_inputs(self.archive(),self.archive(**changed))
