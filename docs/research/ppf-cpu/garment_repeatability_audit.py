"""Pinned same-material native repeatability evidence; no physical-fit acceptance."""
import math
from garment_admission import require

def trajectory_comparison(first,second):
 require(len(first)==len(second) and len(first)>=2,'Incomplete paired frame sets.')
 count=len(first[0]);require(count>0,'Empty paired vertex namespace.')
 require(all(len(frame)==count and all(len(p)==3 and all(math.isfinite(v) for v in p) for p in frame) for frames in [first,second] for frame in frames),'Incomplete/nonfinite paired vertices.')
 by_frame=[];squared_total=0.
 for i,(a,b) in enumerate(zip(first,second)):
  distances=[math.dist(p,q) for p,q in zip(a,b)];squared=sum(v*v for v in distances);squared_total+=squared
  by_frame.append({'frame':i,'maximum_vertex_difference_m':max(distances),'vertex_rms_difference_m':math.sqrt(squared/count)})
 return {'saved_frames':len(first),'vertices_per_frame':count,'maximum_vertex_difference_m':max(r['maximum_vertex_difference_m'] for r in by_frame),'all_saved_vertex_rms_difference_m':math.sqrt(squared_total/(len(first)*count)),'maximum_frame_rms_difference_m':max(r['vertex_rms_difference_m'] for r in by_frame),'final_vertex_rms_difference_m':by_frame[-1]['vertex_rms_difference_m'],'identical_coordinate_frames':sum(a==b for a,b in zip(first,second)),'by_frame':by_frame,'scope':'All saved vertex coordinates only; numerical equality is distinct from raw-byte equality. No tolerance or broad repeatability/physical acceptance is inferred.'}

import argparse,gzip,hashlib,io,json,math,struct,zipfile,tomllib
from pathlib import Path
from bending_audit import verify_manifest
from garment_admission import require
from garment_native_inputs import load_inputs,REVISION,OBJECT,SESSION,CASES
from garment_native_initialization import CLOTH_OFFSET_M,BODY_OFFSET_M
from garment_native_export import verify_export
from garment_warm_start import prepare,load_warm_start
from garment_clearance import outward_preparation,surface_clearance,REQUIRED_CLEARANCE_M
from garment_sewing_layout import sewing_layout
from garment_mass import match_browser_inertia
from garment_motion import measure
from garment_inertia_audit import native_mass_reduction
from garment_clearance_audit import rebuild,LONG_SOURCE_SHA256
from functools import cache
from garment_endpoint_diagnostics import endpoint_diagnostics

COMMAND='#!/bin/bash\nSOLVER_PATH="/home/runner/work/projects-monorepo/projects-monorepo/upstream/target/cpu/release/ppf-contact-solver"\n\nif [ ! -f "$SOLVER_PATH" ]; then\n    echo "Error: Solver does not exist at $SOLVER_PATH" >&2\n    exit 1\nfi\n\n"$SOLVER_PATH" --path "/home/runner/work/projects-monorepo/projects-monorepo/ppf-native-cache/sessions/cpu-garment-CASE_NAME/session" --output "/home/runner/work/projects-monorepo/projects-monorepo/ppf-native-cache/sessions/cpu-garment-CASE_NAME/session/output" "$@"\n'
PROFILES={'one':('17f70fb343db69a176c27262e78566d60090fe65ccdb5c62c9b72d253bcc82a8',1,12164672367),'four':('d29bff83e39b5bb5031f15d2a3d0e8beb6f8b61e23f879ae45e8935808180d0d',4,12164054710)}
THREAD_VARIABLES=['RAYON_NUM_THREADS','OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS']
@cache
def prepared_inputs():return rebuild(Path(__file__).with_name('results'))

def audit(path,verify_archive_hash=True,profile="one"):
 require(profile in PROFILES,'Unknown repeatability profile.')
 archive_hash,threads,artifact_id=PROFILES[profile]
 sources={**LONG_SOURCE_SHA256,'garment_native_probe.py':'a08f7974dc38fca3e98f97394e0669eca8261d3f24883815e260f93b939c00c9'}
 frame_count=61;session={**SESSION,'frames':60};cases={'first':500.,'second':500.}
 variables={key:str(threads) for key in THREAD_VARIABLES}
 settings={'requested_threads':threads,'variables':variables,'scope':'Requested inherited environment, not a measurement of actual native worker counts.'}
 raw=path.read_bytes() if isinstance(path,Path) else path.read();digest=hashlib.sha256(raw).hexdigest()
 if verify_archive_hash:require(digest==archive_hash,'Changed cleared native archive.')
 original,inputs,wp,cp,layout,mass=prepared_inputs()
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  r=json.loads(z.read('receipt.json'));paths=verify_manifest(z,r)
  require(json.loads(gzip.decompress(z.read('native-blueprint-original.json.gz')))==original,'Changed original blueprint.')
  require(json.loads(gzip.decompress(z.read('native-blueprint.json.gz')))==inputs,'Changed cleared blueprint.')
  controls={**OBJECT,'contact-offset':CLOTH_OFFSET_M}
  expected={'experiment':'actual-garment-native-clear-warm-sewing-v1-same-material-control','upstream_revision':REVISION,'source_sha256':sources,'source_artifact_sha256':inputs['source_artifact_sha256'],'object_parameters':controls,'body_contact_offset_m':BODY_OFFSET_M,'initialization':'clear-warm-sewing','initialization_parameters':layout,'warm_start_parameters':wp,'clearance_preparation':cp,'mass_convention':'browser-inertia','mass_parameters':mass,'session_parameters':session,'case_normalized_young':cases,'frames_per_case':frame_count,'case_names':list(cases),'case_session_prefix':'cpu-garment-','same_material_control':True,'execution_settings':settings}
  for k,v in expected.items():require(r.get(k)==v,'Changed cleared receipt '+k)
  require(z.read('upstream-revision.txt').decode().strip()==REVISION and not z.read('upstream-initial-status.txt').strip(),'Changed/dirty upstream source.')
  require('Exit status: 0' in z.read('build-resources.txt').decode(),'Native build did not pass.')
  supervisor=json.loads(z.read('supervisor.json'));require(supervisor['remaining_children']==0 and supervisor['wall_limit_seconds']==300,'Unbounded/incomplete native cleanup.')
  passed=r['status']=='passed_garment_motion_probe';require(passed,'Repeatability requires two completed native cases.')
  require((passed and r['stage']=='completed' and r['fixture_step_outcome']=='success' and r['fixture_exit_code']==0 and supervisor['status']=='completed' and supervisor['exit_code']==0) or (not passed and r['status'] in ['failed_garment_admission','timed_out'] and r['fixture_step_outcome']=='failure' and r['fixture_exit_code'] in [1,124] and supervisor['status'] in ['failed','timed_out']),'Inconsistent native outcome.')
  require(z.read('fixture-exit-code.txt').strip()==str(r['fixture_exit_code']).encode(),'Fixture exit record differs.')
  admitted=r.get('native_input_admission',{});require(list(admitted)==list(cases),'Unexpected native case order.')
  host=json.loads(z.read('thread-settings.json'));require(host['variables']==variables and host['logical_cpu_count']>0 and host['affinity'] and len(set(host['affinity']))==len(host['affinity']),'Changed requested environment/host metadata.')
  diagnostics={};bins={};frames={}
  expected_initial=tuple(struct.unpack('<f',struct.pack('<f',v))[0] for p in inputs['initial'] for v in p)
  for name in admitted:
   prefix=f'native-cache/sessions/cpu-garment-{name}/session/'
   allowed={'command.sh','display_pin_map.pickle','error.log','fixed_session.pickle','info.toml','map.pickle','param.toml','param_summary.txt','statistics_input.cbor','stdout.log'}
   require({n[len(prefix):] for n in paths if n.startswith(prefix) and not n.startswith(prefix+'bin/') and not n.startswith(prefix+'output/')}==allowed,'Changed session sidecars; dynamic schedules are not admitted.')
   command=z.read(prefix+'command.sh').decode()
   expected_command=COMMAND.replace('CASE_NAME',name)
   require(command==expected_command,'Changed native invocation.')
   require(verify_export(lambda p:z.read(prefix+p),inputs,cases[name],object_parameters=controls,body_contact_offset=BODY_OFFSET_M,session_parameters=session)==admitted[name],'Native export admission differs.')
   found={p for p in paths if p.startswith(prefix+'output/vert_') and p.endswith('.bin')}
   count=len(found);require(1<=count<=frame_count and found=={prefix+f'output/vert_{i}.bin' for i in range(count)},'Missing/extra/noncontiguous raw frames.')
   frames[name]=[]
   for i in range(count):
    data=z.read(prefix+f'output/vert_{i}.bin');require(len(data)==7059*4,'Wrong raw frame size.');values=struct.unpack('<7059f',data);require(all(math.isfinite(v) for v in values),'Nonfinite raw frame.')
    if i==0:require(values==expected_initial,'Initial native frame differs.')
    frames[name].append([list(values[j:j+3]) for j in range(0,len(values),3)])
   timing=[line.split() for line in z.read(prefix+'output/data/frame_to_time.out').decode().splitlines() if line.strip()]
   require(len(timing)==count and all(len(row)==2 and int(row[0])==i and math.isfinite(float(row[1])) and math.isclose(float(row[1]),i/60,abs_tol=1e-12,rel_tol=0) for i,row in enumerate(timing)),'Changed saved frame timing.')
   completed=name in r['cases']
   if completed:
    require(count==frame_count and r['cases'][name]['frames']==frame_count and r['cases'][name]['vertices']==2353 and b'simulation finished' in z.read(prefix+'stdout.log') and not z.read(prefix+'error.log').strip(),'Case completion not supported by native output.')
   reduction=native_mass_reduction(lambda p:z.read(prefix+p));reported=[float(v) for v in z.read(prefix+'output/data/total_mass.out').decode().split()]
   require(len(reported)==3 and all(math.isfinite(v) for v in reported) and reported[0]==reported[2]==0 and math.isclose(reported[1],reduction['ordered_float32_diagnostic_mass_kg'],abs_tol=2e-8,rel_tol=0),'Native mass diagnostic differs.')
   require(math.isclose(reduction['accurate_face_mass_kg'],mass['captured_browser_total_mass_kg'],rel_tol=1e-5),'Native physical mass differs from captured mass.')
   diagnostics[name]={'raw_frames':count,'motion_frames':count-1,'completed_case':completed,'mass_reduction':reduction,'reported_mass_kg':reported[1],'metrics':measure(inputs,frames[name]) if count>1 else None}
   if count>1 and completed:require(diagnostics[name]['metrics']['maximum_vertex_displacement_m']>1e-6 and math.isclose(diagnostics[name]['metrics']['maximum_vertex_displacement_m'],r['cases'][name]['maximum_displacement_m'],rel_tol=1e-6),'Saved movement differs.')
   bins[name]={p[len(prefix+'bin/'):]:z.read(p) for p in paths if p.startswith(prefix+'bin/')}
  require(set(r['cases'])<=set(admitted),'Completed case was not admitted.')
  if passed:require(set(r['cases'])==set(cases) and b'cpu actual garment motion probe: PASS' in z.read('fixture.log'),'Missing two-material completion.')
  changed=None
  if set(bins)==set(cases):
   require(set(bins['first'])==set(bins['second']),'Material bin names differ.')
   changed=sorted(p for p in bins['first'] if bins['first'][p]!=bins['second'][p]);require(changed==[],'Same-material native input bytes differ.')
   for p in ['info.toml','param.toml']:require(z.read('native-cache/sessions/cpu-garment-first/session/'+p)==z.read('native-cache/sessions/cpu-garment-second/session/'+p),'Material metadata differs.')
  identical_raw=sum(z.read(f'native-cache/sessions/cpu-garment-first/session/output/vert_{i}.bin')==z.read(f'native-cache/sessions/cpu-garment-second/session/output/vert_{i}.bin') for i in range(frame_count))
  reference=Path(__file__).with_name('results')/'garment-relaxation-native.zip'
  reference_raw=reference.read_bytes()
  require(hashlib.sha256(reference_raw).hexdigest()=='34e09c388d09e2e76b4962da84042f6dc1fd78ec7382a50c9e4447045bda3cdb','Changed original material reference.')
  with zipfile.ZipFile(io.BytesIO(reference_raw)) as ref:
   prefix='native-cache/sessions/cpu-garment-soft/session/'
   require(prefix+'dyn_param.txt' not in ref.namelist(),'Unexpected reference schedule.')
   reference_bins={n[len(prefix+'bin/'):]:ref.read(n) for n in ref.namelist() if n.startswith(prefix+'bin/')}
   require(bins['first']==reference_bins,'Native inputs changed from original one-second soft material.')
   for meta in ['info.toml','param.toml']:require(z.read('native-cache/sessions/cpu-garment-first/session/'+meta)==ref.read(prefix+meta),'Reference scene/session metadata differs.')
  for name in cases:diagnostics[name]['endpoint']=endpoint_diagnostics(inputs,frames[name],1/60)
  return {'archive_sha256':digest,'archive_bytes':len(raw),'artifact_id':artifact_id,'source_commit':'650535a031badf8a6ea33f9f0dea8c819b5aeb11','run_url':'https://github.com/twangyal/projects-monorepo/actions/runs/39203144766','native_files_verified':len(paths),'identical_native_input_bytes':True,'original_soft_reference_inputs_identical':True,'requested_execution_settings':settings,'host':host,'cases':diagnostics,'identical_raw_frames':identical_raw,'trajectory':trajectory_comparison(frames['first'],frames['second']),'supervisor':supervisor,'limits':['One pair per requested environment on separate hosts does not isolate causal thread effects.','Nonzero differences are measured variation, not a population tolerance or material discrimination.','Endpoint collar/shirt threshold counts include stitched neighborhoods and do not reproduce native contact-policy filtering; final snapshots/secants do not establish continuous contact or instantaneous velocity.','No settling, seam-quality, physical fit or backend adoption acceptance.']}

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('archive',type=Path);p.add_argument('--profile',choices=list(PROFILES),required=True);a=p.parse_args();print(json.dumps(audit(a.archive,profile=a.profile),indent=2,allow_nan=False))
