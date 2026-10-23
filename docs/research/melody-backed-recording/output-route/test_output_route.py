import gzip
import lzma
import hashlib
import math
import struct
import tempfile
import json
import shutil
import unittest
from pathlib import Path
from verify_output_route import decode, intervals, metrics, validate_schedule, verify

class RouteTests(unittest.TestCase):
 def test_merge_clips_before_threshold_and_keeps_short_edges(self):
  blocks=[dict(currentFrame=0,frames=128,zeroRuns=[[124,128]]),dict(currentFrame=128,frames=128,zeroRuns=[[0,6]])]
  self.assertEqual(intervals(blocks,120,140),[[4,14]])
  self.assertEqual(intervals(blocks,127,134),[])
  with self.assertRaises(AssertionError):intervals(blocks+blocks,120,140)
 def test_decode_hash_size_members_and_finite_values(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'s.gz';raw=struct.pack('<4f',.1,0,-.1,0);meta={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()};p.write_bytes(gzip.compress(raw))
   self.assertEqual(len(decode(p,meta,'f')),4)
   for data in [gzip.compress(raw)+b'x',gzip.compress(raw+b'x'),gzip.compress(raw)+gzip.compress(raw)]:
    p.write_bytes(data)
    with self.assertRaises(AssertionError):decode(p,meta,'f')
   raw=struct.pack('<f',math.inf);meta={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()};p.write_bytes(gzip.compress(raw))
   with self.assertRaises(AssertionError):decode(p,meta,'f')
 def test_xz_members_bounds_hash_and_decoder_memory_limit(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'signal.xz';raw=struct.pack('<4f',.1,0,-.1,0);meta={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()};p.write_bytes(lzma.compress(raw,preset=6));self.assertEqual(len(decode(p,meta,'f')),4)
   for data in [lzma.compress(raw)+b'x',lzma.compress(raw+b'x'),lzma.compress(raw)+lzma.compress(raw),lzma.compress(raw,preset=9)]:
    p.write_bytes(data)
    with self.assertRaises((AssertionError,lzma.LZMAError)):decode(p,meta,'f')
 def test_metrics_counts_fixed_window_and_whole_capture_gaps(self):
  samples=[math.sin(2*math.pi*440*i/44100+.2)*.25 for i in range(88200)]
  m=metrics(samples,44100);self.assertEqual(m['hz'],440);self.assertEqual(m['zeroRuns'],[])
  samples[60000:60128]=[0]*128;m=metrics(samples,44100);self.assertEqual(m['hz'],440);self.assertEqual(m['zeroRuns'],[[60000,60128]])
 def test_protocol_pair_order_and_single_variable_controls(self):
  rows=[{'pair':i,'route':r}for i in range(10) for r in (['normal','disconnected'] if i%2==0 else ['disconnected','normal'])]
  validate_schedule(rows)
  for bad in [rows[:-1],rows[::-1],rows[:1]+rows[:1]+rows[2:]]:
   with self.assertRaises(AssertionError):validate_schedule(bad)
 def test_resigned_semantic_tampering_is_refused(self):
  root=Path(__file__).resolve().parent
  self.assertEqual(len(verify(root)),20)
  for field in ['endFrame','routes','release','quality','schedule']:
   with tempfile.TemporaryDirectory() as tmp:
    copy=Path(tmp)
    for file in root.iterdir():
     if file.is_file():shutil.copyfile(file,copy/file.name)
    m=json.loads((copy/'manifest.json').read_text());row=m['rows'][0];path=copy/row['receipt'];r=json.loads(path.read_text())
    if field=='endFrame':r['complete']['endFrame']+=1
    elif field=='routes':r['routes'].append('AudioDestinationNode')
    elif field=='release':r['observed']['released']=False
    elif field=='quality':r['qualityError']='invented failure'
    elif field=='schedule':r['observed']['sources'][1]['when']+=.1
    path.write_text(json.dumps(r));row['receiptSha256']=hashlib.sha256(path.read_bytes()).hexdigest();(copy/'manifest.json').write_text(json.dumps(m))
    with self.assertRaises(AssertionError):verify(copy)
if __name__=='__main__':unittest.main()
