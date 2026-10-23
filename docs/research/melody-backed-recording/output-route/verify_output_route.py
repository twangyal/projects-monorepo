"""Independent replay of a bounded original-controller output-route experiment."""
import hashlib
import json
import lzma
import math
import struct
import zlib
from pathlib import Path


def integer(value):
 assert type(value) is int and 0 <= value < 2**53
 return value


def validate_schedule(rows):
 assert [(r['pair'],r['route']) for r in rows] == [(i,r) for i in range(10) for r in (['normal','disconnected'] if i%2==0 else ['disconnected','normal'])]


def decode(path, meta, kind):
 size=integer(meta['bytes']);width={'f':4,'h':2}[kind]
 assert 0<size<=4*192000*20 and size%width==0
 if path.suffix=='.xz':
  d=lzma.LZMADecompressor(memlimit=32*1024*1024);raw=d.decompress(path.read_bytes(),max_length=size+1)
  assert len(raw)==size and d.eof and not d.unused_data
 else:
  d=zlib.decompressobj(16+zlib.MAX_WBITS);raw=d.decompress(path.read_bytes(),size+1)
  assert len(raw)==size and d.eof and not d.unused_data and not d.unconsumed_tail
 assert hashlib.sha256(raw).hexdigest()==meta['sha256']
 values=struct.unpack('<'+str(size//width)+kind,raw)
 assert all(math.isfinite(x) for x in values)
 return values


def intervals(blocks,start,end):
 integer(start);integer(end);assert end>start
 runs=[];previous=-128
 for b in blocks:
  frame=integer(b['currentFrame']);assert frame>=previous+128;previous=frame
  assert b['frames']==128
  last=-1
  for a,z in b['zeroRuns']:
   integer(a);integer(z);assert last<=a<z<=128;last=z
   a,z=max(start,frame+a)-start,min(end,frame+z)-start
   if a<z:
    if runs and runs[-1][1]==a:runs[-1][1]=z
    else:runs.append([a,z])
 return [r for r in runs if r[1]-r[0]>=8]


def metrics(samples,rate):
 integer(rate);assert 8000<=rate<=192000
 runs=[];left=None
 for i in range(len(samples)+1):
  if i<len(samples) and samples[i]==0:
   if left is None:left=i
  elif left is not None:
   if i-left>=8:runs.append([left,i])
   left=None
 start=rate//10;end=min(len(samples)-1,start+rate);assert end>start
 window=samples[start:end]
 return {'zeroRuns':runs,'hz':sum(samples[i-1]<=0<samples[i] for i in range(start+1,end))*rate/(end-start),'rms':math.sqrt(sum(x*x for x in window)/len(window))}


def local(root,name):
 assert type(name) is str and Path(name).name==name and name not in ('.','..')
 return root/name


def verify(root):
 manifest=json.loads((root/'manifest.json').read_text());rows=manifest['rows'];validate_schedule(rows)
 for file,key in [('probe.spec.ts','probeSha256'),('observer.patch','patchSha256')]:
  assert hashlib.sha256((root/file).read_bytes()).hexdigest()==manifest[key]
 results=[]
 for row in rows:
  raw=local(root,row['receipt']).read_bytes();assert hashlib.sha256(raw).hexdigest()==row['receiptSha256'];r=json.loads(raw)
  assert (row['pair'],row['route'])==(r['pair'],r['route'])
  native=pcm=None;nmetrics=pmetrics=None
  if row['native'] is not None:
   native=decode(local(root,row['native']['file']),row['native'],'f');c=r['complete'];rate=integer(c['sampleRate'])
   assert len(native)==c['samples']['frames']==integer(c['endFrame'])-integer(c['startFrame'])
   assert r['bytes']['length']==row['native']['bytes']
   assert 0<len(native)<=rate*20 and c['channels']==2
   for b in r['inputs']:assert b['type']=='zero-input-route300' and b['sampleRate']==rate and b['channels']==2
   nmetrics=metrics(native,rate);assert intervals(r['inputs'],c['startFrame'],c['endFrame'])==nmetrics['zeroRuns']
  else:assert r['complete'] is None and r['error'] is not None
  if row['normalized'] is not None:
   pcm=decode(local(root,row['normalized']['file']),row['normalized'],'h');a=r['normalized'];assert a['frameCount']==len(pcm) and a['sha256']==row['normalized']['sha256']
   assert a['kind']=='microphone' and a['captureTempo']==240
   assert a['decodedSampleRate']==r['complete']['sampleRate'] and a['decodedChannels']==r['complete']['channels']
   pmetrics=metrics([x/32768 for x in pcm],22050)
   quality=abs(pmetrics['rms']-.1768)<.015 and abs(pmetrics['hz']-440)<=2 and 22050<len(pcm)<=441000
   assert quality==(r['qualityError'] is None)
  else:assert r['normalized'] is None and r['error'] is not None
  if r['error'] is None:
   assert native is not None and pcm is not None
   o=r['observed'];assert o['requests']==1 and o['stopped']==1 and o['released'] is True
   assert r['routes']==['AudioDestinationNode']*5
   s=o['sources'];assert len(s)==5 and s[0]['frames']==441000 and s[0]['sampleRate']==22050
   assert len({x['contextRate'] for x in s})==1
   tolerance=1/s[0]['contextRate']
   assert abs(s[0]['when']-s[1]['when']-1)<=tolerance
   for i in range(1,5):assert s[i]['frames']==551 and abs(s[i]['when']-s[1]['when']-(i-1)*.25)<=tolerance
  results.append({'pair':r['pair'],'route':r['route'],'error':r['error'],'qualityPass':r['qualityError'] is None and r['error'] is None,'native':nmetrics,'normalized':pmetrics})
 return results

if __name__=='__main__':print(json.dumps(verify(Path(__file__).resolve().parent),indent=2))
