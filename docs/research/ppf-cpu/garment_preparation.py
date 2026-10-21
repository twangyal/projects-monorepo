"""Declared startup-geometry control; never rewrites captured rest or contact data."""
import copy,gzip,json,math
from functools import cache
from pathlib import Path
from garment_admission import body_gap,require
from garment_native_inputs import load_inputs
from garment_warm_start import prepare,load_warm_start
from garment_clearance import outward_preparation,surface_clearance,REQUIRED_CLEARANCE_M,OUTWARD_OFFSET_M
from garment_sewing_layout import sewing_layout
from garment_mass import match_browser_inertia

PASSES=3
BLEND=.5

def smooth_directions(faces,directions):
 count=len(directions)
 require(count>0 and faces and all(len(v)==3 and all(type(x) in (int,float) and math.isfinite(x) for x in v) and math.isclose(math.hypot(*v),1.,rel_tol=1e-10) for v in directions),'Require finite unit directions.')
 neighbors=[set() for _ in directions]
 for face in faces:
  require(len(face)==3 and len(set(face))==3 and all(type(i) is int and 0<=i<count for i in face),'Invalid smoothing triangle.')
  for i in face:neighbors[i].update(set(face)-{i})
 require(all(neighbors),'Require connected incident faces at every vertex.')
 def unit(v):
  length=math.hypot(*v);require(math.isfinite(length) and length>1e-8,'Undefined smoothed direction.');return [x/length for x in v]
 current=copy.deepcopy(directions)
 for _ in range(PASSES):
  current=[unit([math.fsum(current[j][k] for j in [i,*sorted(adjacent)])/(1+len(adjacent)) for k in range(3)]) for i,adjacent in enumerate(neighbors)]
 return [unit([(1-BLEND)*a[k]+BLEND*b[k] for k in range(3)]) for a,b in zip(directions,current)]

def smoothed_preparation(inputs,body):
 epsilon=1e-5;directions=[]
 for point in inputs['initial']:
  gradient=[]
  for k in range(3):
   a=point[:];b=point[:];a[k]+=epsilon;b[k]-=epsilon;gradient.append((body_gap(a,body)-body_gap(b,body))/(2*epsilon))
  length=math.hypot(*gradient);require(math.isfinite(length) and length>1e-8,'Undefined outward direction.')
  directions.append([v/length for v in gradient])
 directions=smooth_directions(inputs['faces'],directions);result=copy.deepcopy(inputs)
 result['initial']=[[p[k]+OUTWARD_OFFSET_M*directions[i][k] for k in range(3)] for i,p in enumerate(inputs['initial'])]
 return result,{'method':'captured-body-gradient-mesh-blend-v1','outward_offset_m':OUTWARD_OFFSET_M,'gradient_epsilon_m':epsilon,'smoothing_passes':PASSES,'original_smoothed_blend':BLEND,'required_mesh_clearance_m':REQUIRED_CLEARANCE_M,'scope':'Fixed startup-geometry control only; unchanged rest, body, seams and captured mass. Not native admission or physical fit.'}

def outward(inputs,body,mode):
 require(mode in ('reference','smoothed'),'Unknown preparation mode.')
 return outward_preparation(inputs,body) if mode=='reference' else smoothed_preparation(inputs,body)

@cache
def rebuild(mode):
 require(mode in ('reference','smoothed'),'Unknown preparation mode.')
 root=Path(__file__).with_name('results');original=load_inputs(root);warm,wp=prepare(original,load_warm_start(root),root)
 body=json.loads(gzip.decompress((root/'garment-first.json.gz').read_bytes()))['packet']['body']
 candidate,cp=outward(warm,body,mode);candidate,layout=sewing_layout(candidate)
 cp['surface_admission']=surface_clearance(candidate,REQUIRED_CLEARANCE_M)
 require(cp['surface_admission']['violations']==0,'Preparation does not pass unchanged surface gate.')
 inputs,mass=match_browser_inertia(original,candidate,root)
 return original,inputs,wp,cp,layout,mass
