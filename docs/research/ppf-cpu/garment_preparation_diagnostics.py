"""Trace frozen startup stages; no simulation, contact or physical-fit acceptance."""
import argparse,copy,gzip,hashlib,json,math,struct,zipfile
from pathlib import Path
from garment_admission import require
from garment_native_inputs import load_inputs
from garment_warm_start import prepare,load_warm_start
from garment_clearance import outward_preparation
from garment_sewing_layout import sewing_layout
from garment_preparation import smoothed_preparation
from garment_principal_strain import principal_strain,triangle_strain

ROOT=Path(__file__).with_name('results')
TRACKED=[1040,1160,3091]

def stage(inputs,previous=None):
 points=inputs['initial'];report=principal_strain(inputs,points)
 tracked=[]
 for i in TRACKED:
  face=inputs['faces'][i]
  tracked.append({'native_triangle':i,'vertices':face,'source':inputs['face_source'][i],**triangle_strain([inputs['rest'][v] for v in face],[points[v] for v in face])})
 return {'initial_positions_sha256':hashlib.sha256(json.dumps(points,separators=(',',':'),allow_nan=False).encode()).hexdigest(),'principal_strain':report,'tracked_triangles':tracked,'maximum_vertex_change_m':max((math.dist(a,b) for a,b in zip(points,previous['initial'])),default=0.) if previous else None}

def diagnose():
 cold=load_inputs(ROOT);warm,wp=prepare(cold,load_warm_start(ROOT),ROOT)
 body=json.loads(gzip.decompress((ROOT/'garment-first.json.gz').read_bytes()))['packet']['body']
 original,_=outward_preparation(warm,body);smoothed,_=smoothed_preparation(warm,body)
 stages={'captured':stage(cold),'browser_warm':stage(warm,cold)}
 frames={}
 for name,offset in [('reference',original),('smoothed',smoothed)]:
  sewn,_=sewing_layout(offset);rounded=copy.deepcopy(sewn);rounded['initial']=[[struct.unpack('<f',struct.pack('<f',x))[0] for x in p] for p in sewn['initial']]
  for item in [offset,sewn,rounded]:
   require({k:v for k,v in item.items() if k!='initial'}=={k:v for k,v in cold.items() if k!='initial'},'Preparation stage changed frozen inputs beyond initial positions.')
  stages[name+'_offset']=stage(offset,warm);stages[name+'_sewn']=stage(sewn,offset);stages[name+'_float32']=stage(rounded,sewn);frames[name]=rounded['initial']
 from garment_fixed_material_audit import GRAVITY_PROFILES
 path=ROOT/'garment-gravity-reference.zip';raw=path.read_bytes();require(hashlib.sha256(raw).hexdigest()==GRAVITY_PROFILES['reference'][0],'Changed retained gravity reference.')
 with zipfile.ZipFile(path) as z:
  saved=z.read('native-cache/sessions/cpu-garment-soft/session/output/vert_0.bin');values=struct.unpack('<7059f',saved)
  require(list(values)==[x for p in frames['reference'] for x in p],'Rebuilt startup differs from retained native frame0.')
 source_names=['garment_preparation_diagnostics.py','garment_preparation.py','garment_warm_start.py','garment_clearance.py','garment_sewing_layout.py','garment_principal_strain.py']
 return {'schema':1,'experiment':'startup-stage-strain-localization-v1','source_sha256':{n:hashlib.sha256(Path(__file__).with_name(n).read_bytes()).hexdigest() for n in source_names},'source_artifact_sha256':cold['source_artifact_sha256'],'warm_start_edge_admission':wp,'tracked_native_triangles':TRACKED,'reference_native_frame0_sha256':hashlib.sha256(saved).hexdigest(),'stages':stages,'limits':['Stages are frozen geometric snapshots, not independent native trajectories or physical tolerances.','Edge-strain admission and principal face strain measure different quantities; the50% edge guard is not a principal-strain bound.','Clearance changes the peak location/type; stage differences do not isolate every final underarm-strain cause.','No rest geometry, body, mass source, stitch or shipping solver changes.']}

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('out',type=Path);a=p.parse_args();a.out.write_text(json.dumps(diagnose(),indent=2,allow_nan=False)+'\n')
