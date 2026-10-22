import gzip,hashlib,struct,tempfile,unittest
from pathlib import Path
from verify_graph_paths import input_runs,decode_signal,metrics

def block(frame,runs):return dict(type='zero-input-graph300',currentFrame=frame,sampleRate=44100,channels=2,frames=128,zeroRuns=runs)
class GraphEvidenceTests(unittest.TestCase):
 def test_short_fragments_merge_before_length_filter(self):
  self.assertEqual(input_runs([block(0,[[120,128]]),block(128,[[0,2]])],2,130),[[118,128]])
  self.assertEqual(input_runs([block(0,[[124,128]]),block(128,[[0,3]])],0,256),[])
 def test_clip_and_duplicate_or_invalid_blocks(self):
  self.assertEqual(input_runs([block(0,[[0,128]]),block(128,[[0,128]])],32,200),[[0,168]])
  for data in [[block(0,[[0,128]])]*2,[block(128,[[0,128]]),block(0,[[0,128]])],[block(0,[[2,129]])]]:
   with self.assertRaises(AssertionError):input_runs(data,0,256)
 def test_full_hash_bounded_gzip_and_finite_samples(self):
  with tempfile.TemporaryDirectory()as d:
   p=Path(d)/'x.gz';raw=struct.pack('<3f',0,.25,-.25);p.write_bytes(gzip.compress(raw,mtime=0));m=dict(bytes=12,sha256=hashlib.sha256(raw).hexdigest())
   self.assertEqual(decode_signal(p,m),(0,.25,-.25))
   for changed in [m|{'bytes':4},m|{'sha256':'0'*64}]:
    with self.assertRaises(AssertionError):decode_signal(p,changed)
   p.write_bytes(p.read_bytes()+b'x')
   with self.assertRaises(AssertionError):decode_signal(p,m)
   raw=struct.pack('<f',float('nan'));p.write_bytes(gzip.compress(raw,mtime=0))
   with self.assertRaises(AssertionError):decode_signal(p,dict(bytes=4,sha256=hashlib.sha256(raw).hexdigest()))
 def test_all_silence_control_and_window_metrics(self):
  r=metrics([0.0]*88200);self.assertEqual(r['zeroRuns'],[[0,88200]]);self.assertEqual(r['hz'],0);self.assertEqual(r['rms'],0)
if __name__=='__main__':unittest.main()
