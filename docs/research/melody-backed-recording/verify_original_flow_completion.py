#!/usr/bin/env python3
"""Verify retained native regions and unchanged normalized frequency outcomes."""
import base64,hashlib,json,math,struct,zlib
from pathlib import Path
root=Path(__file__).parent
r=json.loads((root/'2026-10-22-original-flow-completion.json').read_text())
assert len(r['rows'])==20 and sum(not x['originalFrequencyGatePassed'] for x in r['rows'])==3
assert r['patchSha256']==hashlib.sha256((root/'original_flow_completion.patch').read_bytes()).hexdigest()
def decode(encoded,maximum):
 z=zlib.decompressobj(16+zlib.MAX_WBITS);b=z.decompress(base64.b64decode(encoded,validate=True),maximum+1)
 assert len(b)<=maximum and z.eof and not z.unused_data and not z.unconsumed_tail
 return b
def runs(samples):
 out=[];i=0
 while i<len(samples):
  if samples[i]!=0:i+=1;continue
  j=i+1
  while j<len(samples) and samples[j]==0:j+=1
  if j-i>=8:out.append((i,j))
  i=j
 return out
out=[]
for pair in r['retainedPairs']:
 row=next(x for x in r['rows'] if x['case']==pair['case']);pcm=decode(pair['normalizedPcmGzipBase64'],882000)
 assert hashlib.sha256(pcm).hexdigest()==row['normalized']['pcmSha256']
 a=struct.unpack('<%dh'%(len(pcm)//2),pcm);hz=sum(a[i-1]<=0<a[i] for i in range(2206,24255))
 assert hz==row['normalized']['frequencyWindowHz'] and (abs(hz-440)<=2)==row['originalFrequencyGatePassed']
 assert runs(a)==[(x['start'],x['endExclusive']) for x in row['normalized']['zeroRuns']]
 for region,native_run in zip(pair['nativeRegions'],row['native']['exactZeroRunsAtLeast8Frames'],strict=True):
  data=decode(region['gzipBase64'],100000);assert len(data)==4*(region['endFrame']-region['startFrame'])
  assert hashlib.sha256(data).hexdigest()==region['float32leSha256']
  floats=struct.unpack('<%df'%(len(data)//4),data);assert all(math.isfinite(x) for x in floats)
  assert runs(floats)==[(native_run['start']-region['startFrame'],native_run['endExclusive']-region['startFrame'])]
 out.append({'case':pair['case'],'normalizedWindowHz':hz,'originalGatePassed':row['originalFrequencyGatePassed'],'nativeZeroRuns':row['native']['exactZeroRunsAtLeast8Frames'],'normalizedZeroRuns':row['normalized']['zeroRuns']})
print(json.dumps({'verifiedPairs':len(out),'results':out,'normalizationFirstSourceOfObservedSilence':False,'inputVersusCollectorCauseEstablished':False},indent=2))

port=json.loads((root/'2026-10-22-original-flow-input-blocks.json').read_text())
assert port['patchSha256']==hashlib.sha256((root/'original_flow_input_blocks.patch').read_bytes()).hexdigest()
assert port['control']['messages']>0 and port['control']['controllerRetainedSilenceRefusal'] is True
assert len(port['originalFlowCases'])==10
for row in port['originalFlowCases']:
 assert not row['completion']['exactZeroRunsAtLeast8Frames'] and not row['zeroIntervalsIntersectingRetainedCapture']
 for block in row['inputZeroBlocks']:
  assert block['type']=='diagnostic-input300' and block['sampleRate']==44100 and block['channels']==2 and block['frames']==128
  assert all(0<=a<b<=128 and b-a>=8 for a,b in block['zeroRuns'])
print(json.dumps({'validatedSilentPortControl':True,'inputCohortCases':10,'retainedGapReproducedWithInputObserver':False}))
