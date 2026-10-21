import io,unittest,zipfile
from garment_bending_comparison import pair_inputs
class BendingPair(unittest.TestCase):
 def archive(self,zero=False,**changes):
  p='native-cache/sessions/cpu-garment-soft/session/'
  f={p+'bin/param/tri-bend.bin':b'zero' if zero else b'20',p+'bin/rest_vert.bin':b'rest',p+'bin/vert.bin':b'initial',p+'info.toml':b'scene',p+'param.toml':b'normal','native-binary-sha256.txt':b'a'*64+b'  /native'};f.update(changes);out=io.BytesIO()
  with zipfile.ZipFile(out,'w') as z:
   for k,v in f.items():z.writestr(k,v)
  out.seek(0);return out
 def test_only_declared_bend_differs(self):
  x=pair_inputs(self.archive(),self.archive(True));self.assertEqual(x['changed_native_arrays'],['param/tri-bend.bin']);self.assertTrue(x['identical_scene_and_session_metadata'])
 def test_unrelated_physical_or_metadata_changes_refuse(self):
  p='native-cache/sessions/cpu-garment-soft/session/'
  for k,v in [(p+'bin/rest_vert.bin',b'forged'),(p+'bin/vert.bin',b'forged'),(p+'bin/param/tri-bend.bin',b'20'),(p+'param.toml',b'zero-gravity'),(p+'info.toml',b'new'),('native-binary-sha256.txt',b'b'*64+b'  /native')]:
   with self.subTest(k=k),self.assertRaises(ValueError):pair_inputs(self.archive(),self.archive(True,**{k:v}))
