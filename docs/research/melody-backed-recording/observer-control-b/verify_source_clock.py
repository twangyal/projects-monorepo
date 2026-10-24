"""Replay the fixed source-clock cohort using bounded historical PCM primitives."""
import hashlib,json,importlib.util,math
from pathlib import Path
BASE=Path(__file__).resolve().parents[1]/'output-route'/'verify_output_route.py'
spec=importlib.util.spec_from_file_location('route_primitives',BASE)
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
integer,decode,intervals,metrics,local=base.integer,base.decode,base.intervals,base.metrics,base.local

def validate_schedule(rows):
 assert [(r['pair'],r['mode'],r['route']) for r in rows] == [(i,m,'normal') for i in range(6) for m in (['on','off'] if i%2==0 else ['off','on'])]

def validate_observer(r):
 assert r['mode'] in ('on','off')
 assert type(r['observerModes']) is list and len(r['observerModes'])==1 and type(r['observerModes'][0]) is bool
 assert r['observerModes']==[r['mode']=='on']
 if r['mode']=='off':assert r['inputs']==[]

def validate_startup(r):
 s=r['observed']['startup'];mode=r['mode'];assert mode in ('on','off')
 if s is None:
  assert r['error'] is not None;return None
 requested=0
 assert s['requested']==requested
 for key in ['startTime','handoffTime','wallMs']:
  assert type(s[key]) in (int,float) and math.isfinite(s[key]) and s[key]>=0
 assert s['handoffTime']>=s['startTime']
 if r['error'] is None:
  assert s['stateBefore']==s['stateAfter']=='running'
  assert s['handoffTime']-s['startTime']>=requested
 return s

def verify(root):
 manifest=json.loads((root/'manifest.json').read_text());rows=manifest['rows'];validate_schedule(rows)
 assert hashlib.sha256(BASE.read_bytes()).hexdigest()==manifest['primitivesSha256']
 for file,key in [('probe.spec.ts','probeSha256'),('observer.patch','patchSha256')]:
  assert hashlib.sha256((root/file).read_bytes()).hexdigest()==manifest[key]
 results=[]
 for row in rows:
  raw=local(root,row['receipt']).read_bytes();assert hashlib.sha256(raw).hexdigest()==row['receiptSha256'];r=json.loads(raw)
  assert (row['pair'],row['route'],row['mode'])==(r['pair'],r['route'],r['mode'])
  native=pcm=None;nmetrics=pmetrics=None
  if row['native'] is not None:
   native=decode(local(root,row['native']['file']),row['native'],'f');c=r['complete'];rate=integer(c['sampleRate'])
   assert len(native)==c['samples']['frames']==integer(c['endFrame'])-integer(c['startFrame'])
   assert r['bytes']['length']==row['native']['bytes']
   assert 0<len(native)<=rate*20 and c['channels']==2
   for b in r['inputs']:assert b['type']=='zero-input-route300' and b['sampleRate']==rate and b['channels']==2
   nmetrics=metrics(native,rate)
   validate_observer(r)
   if r['mode']=='on':assert intervals(r['inputs'],c['startFrame'],c['endFrame'])==nmetrics['zeroRuns']
   else:assert r['inputs']==[]
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
  results.append({'pair':r['pair'],'mode':r['mode'],'startup':validate_startup(r), 'route':r['route'],'error':r['error'],'qualityPass':r['qualityError'] is None and r['error'] is None,'native':nmetrics,'normalized':pmetrics})
 return results

if __name__=='__main__':print(json.dumps(verify(Path(__file__).resolve().parent),indent=2))
