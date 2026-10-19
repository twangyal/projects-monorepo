"""Final saved-snapshot contacts/secant motion; no settling acceptance."""
import argparse,json,math,struct,zipfile
from pathlib import Path
from garment_admission import require
from garment_clearance import surface_clearance
from garment_clearance_audit import audit,rebuild
from garment_native_initialization import CLOTH_OFFSET_M,BODY_OFFSET_M

def secant_speeds(frames,dt):
 require(len(frames)>=2 and math.isfinite(dt) and dt>0,'Invalid sampling interval.')
 a,b=frames[-2:];require(a and len(a)==len(b),'Incomplete endpoint vertices.')
 require(all(len(p)==3 and all(math.isfinite(v) for v in p) for f in [a,b] for p in f),'Nonfinite endpoint coordinates.')
 speeds=[math.dist(p,q)/dt for p,q in zip(a,b)]
 return {'maximum_m_s':max(speeds),'rms_m_s':math.sqrt(sum(v*v for v in speeds)/len(speeds))}

def endpoint_diagnostics(inputs,frames,dt):
 candidate={**inputs,'initial':frames[-1]}
 rib=[f for f,s in zip(inputs['faces'],inputs['face_source']) if s['part']=='neckband']
 shirt=[f for f,s in zip(inputs['faces'],inputs['face_source']) if s['part']!='neckband']
 return {'last_saved_interval_secant_speed':secant_speeds(frames,dt),'cloth_body_surface':surface_clearance(candidate,CLOTH_OFFSET_M+BODY_OFFSET_M),'collar_shirt_surface':surface_clearance({'initial':frames[-1],'faces':rib,'body_vertices':frames[-1],'body_faces':shirt},2*CLOTH_OFFSET_M)}

def replay(path,observation="short"):
 evidence=audit(path,observation=observation);require(evidence["two_material_bounded_motion_complete"],"Endpoint comparison requires both completed materials.");_,inputs,*_=rebuild(Path(__file__).with_name('results'));cases={}
 with zipfile.ZipFile(path) as z:
  for name,case in evidence['cases'].items():
   count=case['raw_frames'];require(count>=2,'Missing endpoint pair.');frames=[]
   for i in [count-2,count-1]:
    v=struct.unpack('<7059f',z.read(f'native-cache/sessions/cpu-garment-{name}/session/output/vert_{i}.bin'))
    frames.append([list(v[j:j+3]) for j in range(0,len(v),3)])
   cases[name]=endpoint_diagnostics(inputs,frames,1/60)
 return {'archive_sha256':evidence['archive_sha256'],'final_saved_time_seconds':(next(iter(evidence['cases'].values()))['raw_frames']-1)/60,'sampling_interval_seconds':1/60,'cases':cases,'scope':'Final snapshot offset-distance thresholds and last saved-interval secant speeds only. Collar/shirt counts include stitched seam neighborhoods and do not reproduce native contact-policy filtering. No inside/outside, full cloth self-contact, continuous trajectory, instantaneous velocity, settling or physical fit acceptance.'}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('archive',type=Path);p.add_argument('--observation',choices=['short','one-second'],default='short');a=p.parse_args();print(json.dumps(replay(a.archive,observation=a.observation),indent=2,allow_nan=False))
