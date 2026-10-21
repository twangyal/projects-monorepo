import io,unittest,zipfile
from garment_preparation_comparison import pair_inputs
class PreparationPair(unittest.TestCase):
 def archive(self,candidate=False,**changes):
  p='native-cache/sessions/cpu-garment-soft/session/'
  files={p+'bin/vert.bin':b'new' if candidate else b'old',p+'bin/param/tri-density.bin':b'newmass' if candidate else b'oldmass',p+'bin/rest_vert.bin':b'original',p+'info.toml':b'scene',p+'param.toml':b'normal', 'native-binary-sha256.txt':b'a'*64+b'  /native'}
  files.update(changes);stream=io.BytesIO()
  with zipfile.ZipFile(stream,'w') as z:
   for k,v in files.items():z.writestr(k,v)
  stream.seek(0);return stream
 def test_only_declared_geometry_and_inertia_coefficients_differ(self):
  result=pair_inputs(self.archive(),self.archive(True));self.assertEqual(result['changed_native_arrays'],['param/tri-density.bin','vert.bin'])
 def test_rest_metadata_executable_and_missing_coefficient_change_refuse(self):
  p='native-cache/sessions/cpu-garment-soft/session/'
  for key,value in [(p+'bin/rest_vert.bin',b'forged'),(p+'param.toml',b'zero'),(p+'bin/param/tri-density.bin',b'oldmass'),('native-binary-sha256.txt',b'b'*64+b'  /native')]:
   with self.subTest(key=key),self.assertRaises(ValueError):pair_inputs(self.archive(),self.archive(True,**{key:value}))
