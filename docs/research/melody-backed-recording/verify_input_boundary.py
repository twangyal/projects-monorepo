#!/usr/bin/env python3
"""Independent replay of this fixed Chromium143 input-boundary cohort, not a product gate."""
import base64, hashlib, json, math, struct, zlib
from pathlib import Path

def integer(x):
    return type(x) is int and 0 <= x <= 2**53-1

def input_intervals(blocks, start, end):
    assert integer(start) and integer(end) and start < end
    intervals=[]; previous=-128
    for b in blocks:
        assert b['type']=='diagnostic-input300' and integer(b['currentFrame'])
        assert b['sampleRate']==44100 and b['channels']==2 and b['frames']==128
        assert b['currentFrame']>=previous+128
        previous=b['currentFrame']; last=-1
        for a,z in b['zeroRuns']:
            assert integer(a) and integer(z) and 0<=a<z<=128 and z-a>=8 and a>last
            last=z
            a=max(start,b['currentFrame']+a); z=min(end,b['currentFrame']+z)
            if a>=z: continue
            a-=start;z-=start
            if intervals and intervals[-1][1]==a: intervals[-1][1]=z
            else: intervals.append([a,z])
    return intervals

def decode_capture(payload,kind):
    assert kind in ('f','h','bytes') and type(payload['bytes']) is int and 0<payload['bytes']<=3528000
    encoded=base64.b64decode(payload['gzipBase64'],validate=True)
    z=zlib.decompressobj(16+zlib.MAX_WBITS); data=z.decompress(encoded,payload['bytes']+1)
    assert len(data)==payload['bytes'] and z.eof and not z.unused_data and not z.unconsumed_tail
    assert hashlib.sha256(data).hexdigest()==payload['sha256']
    if kind=='bytes': return data
    width=4 if kind=='f' else 2; assert len(data)%width==0
    values=struct.unpack('<%d%s'%(len(data)//width,kind),data)
    assert all(math.isfinite(x) for x in values)
    return values

def zero_runs(samples):
    out=[];a=0
    while a<len(samples):
        if samples[a]!=0: a+=1; continue
        z=a+1
        while z<len(samples) and samples[z]==0: z+=1
        if z-a>=8: out.append([a,z])
        a=z
    return out

def frequency(pcm):
    start=2205;end=min(len(pcm)-1,start+22050);assert end>start
    hz=sum(pcm[i-1]<=0<pcm[i] for i in range(start+1,end))*22050/(end-start)
    rms=math.sqrt(sum((pcm[i]/32768)**2 for i in range(start,end))/(end-start))
    return {'hz':hz,'rms':rms,'originalFrequencyGatePassed':abs(hz-440)<=2,'originalRmsGatePassed':abs(rms-.1768)<.015}

def verify(path):
    r=json.loads(Path(path).read_text());root=Path(path).parent
    assert r['source']=='1bc71780b19c8a522fb355d6c26a18bc4338edbe'
    assert r['requestedRepetitions']==30 and len(r['rows'])==30
    assert len({row['case'] for row in r['rows']})==30
    assert hashlib.sha256((root/r['patch']).read_bytes()).hexdigest()==r['patchSha256']
    control=r['control']; assert control['passed'] and control['messages']
    control_blocks=json.loads(decode_capture(control['rawMessages'],'bytes'))
    assert len(control_blocks)==control['messages']
    input_intervals(control_blocks,0,2**32)
    for row in r['rows']:
        assert row['status'] in ('passed','failed','timedOut')
        if row['native'] is None: assert row['status']!='passed';continue
        n=row['native'];assert n['sampleRate']==44100 and n['endFrame']-n['startFrame']==n['frames']
        intervals=input_intervals(row['inputZeroBlocks'],n['startFrame'],n['endFrame'])
        assert intervals==row['incomingZeroIntervalsRelativeToCapture']
        assert (intervals==n['zeroRuns'])==row['inputExactlyMatchesNativeZeroRuns']
        if row['status']=='passed': assert row['normalized']['originalFrequencyGatePassed'] and row['normalized']['originalRmsGatePassed']
    for pair in r['retainedCaptures']:
        row=next(x for x in r['rows'] if x['case']==pair['case'])
        pcm=decode_capture(pair['normalizedPcm16'],'h')
        assert pair['normalizedPcm16']['sha256']==row['normalized']['sha256']
        assert len(pcm)==row['normalized']['frames'] and zero_runs(pcm)==row['normalized']['zeroRuns']
        assert len(pair['nativeRegions'])==len(row['native']['zeroRuns'])
        for region,run in zip(pair['nativeRegions'],row['native']['zeroRuns'],strict=True):
            raw=decode_capture(region,'f'); offset=region['startFrame']
            assert len(raw)==region['endFrame']-offset
            assert zero_runs(raw)==[[run[0]-offset,run[1]-offset]]
        metrics=frequency(pcm)
        for key,value in metrics.items(): assert value==row['normalized'][key]
    return {'cases':len(r['rows']),'passed':sum(x['status']=='passed' for x in r['rows']),'nativeGapCases':sum(bool(x['native'] and x['native']['zeroRuns']) for x in r['rows']),'retainedPcmAndNativeRegionPairs':len(r['retainedCaptures'])}

if __name__=='__main__':
    print(json.dumps(verify(Path(__file__).with_name('2026-10-22-input-boundary-cohort.json')),indent=2))
