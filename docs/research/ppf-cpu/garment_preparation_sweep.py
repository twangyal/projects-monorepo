"""Reproduce the exploratory static family; native control stays frozen elsewhere."""
import argparse,copy,gzip,hashlib,json,math
from pathlib import Path
from garment_admission import body_gap,require
from garment_native_inputs import load_inputs
from garment_warm_start import prepare,load_warm_start
from garment_sewing_layout import sewing_layout
from garment_clearance import surface_clearance,REQUIRED_CLEARANCE_M
from garment_principal_strain import principal_strain
from garment_preparation import smoothed_preparation

TRIALS=[(p,1.,offset) for p in [1,3] for offset in [.005,.0075,.01]]+[(p,1.,.005) for p in [5,10,20]]+[(3,blend,.005) for blend in [.25,.5,.75]]

def sweep():
 root=Path(__file__).with_name('results');original=load_inputs(root);warm,_=prepare(original,load_warm_start(root),root);body=json.loads(gzip.decompress((root/'garment-first.json.gz').read_bytes()))['packet']['body']
 neighbors=[set() for _ in warm['initial']]
 for face in warm['faces']:
  for i in face:neighbors[i].update(set(face)-{i})
 def unit(v):
  length=math.hypot(*v);require(length>1e-8 and math.isfinite(length),'Undefined exploratory direction.');return [x/length for x in v]
 directions=[]
 for point in warm['initial']:
  gradient=[]
  for k in range(3):
   a=point[:];b=point[:];a[k]+=1e-5;b[k]-=1e-5;gradient.append((body_gap(a,body)-body_gap(b,body))/(2e-5))
  directions.append(unit(gradient))
 rows=[]
 for passes,blend,offset in TRIALS:
  current=copy.deepcopy(directions)
  for _ in range(passes):current=[unit([math.fsum(current[j][k] for j in [i,*sorted(ids)])/(1+len(ids)) for k in range(3)]) for i,ids in enumerate(neighbors)]
  mixed=[unit([(1-blend)*a[k]+blend*b[k] for k in range(3)]) for a,b in zip(directions,current)]
  candidate=copy.deepcopy(warm);candidate['initial']=[[p[k]+offset*mixed[i][k] for k in range(3)] for i,p in enumerate(warm['initial'])]
  if (passes,blend,offset)==(3,.5,.005):require(candidate==smoothed_preparation(warm,body)[0],'Exploratory selected control differs from frozen native helper.')
  candidate,layout=sewing_layout(candidate);metric=principal_strain(candidate,candidate['initial'])['overall'];gate=surface_clearance(candidate,REQUIRED_CLEARANCE_M)
  rows.append({'smoothing_passes':passes,'original_smoothed_blend':blend,'offset_m':offset,'selected_native_control':(passes,blend,offset)==(3,.5,.005),'maximum_absolute_principal_strain':metric['maximum_absolute_principal_strain'],'rest_area_weighted_absolute_strain_p95':metric['rest_area_weighted_absolute_strain_p95'],'surface_admission':gate})
 return {'schema':1,'experiment':'exploratory-static-direction-family-v1','source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'rows':rows,'scope':'Exploratory selection before native outcomes, not preregistered search or physical tolerance. All12 explored controls retained; only the fixed3pass/.5blend/5mm candidate is selected for native comparison. Static metrics use double positions; the unchanged surface gate rounds float32. No simulation/settling/fit acceptance.'}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('out',type=Path);a=p.parse_args();a.out.write_text(json.dumps(sweep(),indent=2,allow_nan=False)+'\n')
