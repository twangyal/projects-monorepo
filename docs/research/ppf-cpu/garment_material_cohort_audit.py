"""Replay declared repaired Young500/2000 native evidence; not calibrated fabric."""
import argparse,gzip,hashlib,io,json,math,struct,zipfile,tomllib
from pathlib import Path
from bending_audit import verify_manifest
from garment_admission import require
from garment_archive_storage import read_archive
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

from garment_repeatability_audit import COMMAND,THREAD_VARIABLES,prepared_inputs,trajectory_comparison
# No default acceptance until actual native archives are retained and registered.
PROFILES={'one':('e41f7f362b46440f1d218398fae5e5a74be500f0af546c04a35e3dc248d960a9',1,12182450858),'four':('adb968450a6e82b26dd50601c6bfcb282ac12c71f279b054af6f9d4860ba1818',4,12182535783)}
DURATION_PROFILES={'one':('48b0ccfc4232242081babfc42c04ec18e6cb17835e9dc962ba601f4e7c294d4b',1,12182494397,{'status':'timed_out','counts':{'soft':181,'stiff':168},'completed':['soft']}),'four':('af0c6e074e4625bdcb33d9180411ad1a463ba316dd2e96e1e06c1c2c1933289c',4,12183171227,{'status':'passed_garment_motion_probe','counts':{'soft':181,'stiff':181},'completed':['soft','stiff']})}
def audit(path,verify_archive_hash=True,profile="one",observation="one-second"):
 require(observation in ["one-second","three-second"],"Unknown material observation.")
 longer=observation=="three-second";registry=DURATION_PROFILES if longer else PROFILES
 require(profile in registry,'Unknown material cohort profile.')
 archive_hash,threads,artifact_id,*outcomes=registry[profile]
 outcome=outcomes[0] if longer else {'status':'passed_garment_motion_probe','counts':{'soft':61,'stiff':61},'completed':['soft','stiff']}
 sources={**LONG_SOURCE_SHA256,'garment_native_probe.py':'a08f7974dc38fca3e98f97394e0669eca8261d3f24883815e260f93b939c00c9'}
 if longer:sources.update({'garment_native_probe.py':'15a589c5f1022a36aa7b139599b6282757d85cba21a08a7e114ecbc491cf3e31','garment_native_export.py':'b471efece350968ed8629dbadb635f50798615892ddde7572f6591558ba59209'})
 frame_count=181 if longer else 61;session={**SESSION,'frames':frame_count-1};cases=dict(CASES)
 variables={key:str(threads) for key in THREAD_VARIABLES}
 settings={'requested_threads':threads,'variables':variables,'scope':'Requested inherited environment, not a measurement of actual native worker counts.'}
 raw=read_archive(path);digest=hashlib.sha256(raw).hexdigest()
 if verify_archive_hash:require(isinstance(archive_hash,str) and digest==archive_hash,'Changed cleared native archive.')
 original,inputs,wp,cp,layout,mass=prepared_inputs()
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  from garment_mesh_patch_evidence import verify_research_patch
  patch=verify_research_patch(z)
  r=json.loads(z.read('receipt.json'));paths=verify_manifest(z,r)
  require(not any(k in r for k in ['same_material_control','unsewn_control']),'Unexpected same-material/unsewn receipt controls.')
  if longer:require(r.get('relaxation_study') is True and r.get('execution_settings')==settings,'Changed explicit duration-study settings.')
  else:require(not any(k in r for k in ['relaxation_study','execution_settings']),'Unexpected duration-study receipt controls.')
  require(json.loads(gzip.decompress(z.read('native-blueprint-original.json.gz')))==original,'Changed original blueprint.')
  require(json.loads(gzip.decompress(z.read('native-blueprint.json.gz')))==inputs,'Changed cleared blueprint.')
  controls={**OBJECT,'contact-offset':CLOTH_OFFSET_M}
  expected={'experiment':'actual-garment-native-clear-warm-sewing-v1'+('-relaxation-study' if longer else ''),'upstream_revision':REVISION,'source_sha256':sources,'source_artifact_sha256':inputs['source_artifact_sha256'],'object_parameters':controls,'body_contact_offset_m':BODY_OFFSET_M,'initialization':'clear-warm-sewing','initialization_parameters':layout,'warm_start_parameters':wp,'clearance_preparation':cp,'mass_convention':'browser-inertia','mass_parameters':mass,'session_parameters':session,'case_normalized_young':cases,'frames_per_case':frame_count,'case_names':list(cases),'case_session_prefix':'cpu-garment-'}
  for k,v in expected.items():require(r.get(k)==v,'Changed cleared receipt '+k)
  require(z.read('upstream-revision.txt').decode().strip()==REVISION and not z.read('upstream-initial-status.txt').strip(),'Changed/dirty upstream source.')
  require('Exit status: 0' in z.read('build-resources.txt').decode(),'Native build did not pass.')
  supervisor=json.loads(z.read('supervisor.json'));require(supervisor['remaining_children']==0 and supervisor['wall_limit_seconds']==300,'Unbounded/incomplete native cleanup.')
  passed=r['status']=='passed_garment_motion_probe'
  require(r['status']==outcome['status'] and list(r['cases'])==outcome['completed'],'Changed frozen native outcome; partial motion is not completion.')
  if not passed:require(longer and r['status']=='timed_out' and r['stage']=='native_execution' and r['current_case']=='stiff' and supervisor['status']=='timed_out' and supervisor['exit_code']==124 and supervisor['wall_seconds_including_cleanup']>=300,'Undeclared partial native outcome.')
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
   count=len(found);require(count==outcome['counts'][name] and found=={prefix+f'output/vert_{i}.bin' for i in range(count)},'Missing/extra/noncontiguous raw frames.')
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
   require(set(bins['soft'])==set(bins['stiff']),'Material bin names differ.')
   changed=sorted(p for p in bins['soft'] if bins['soft'][p]!=bins['stiff'][p]);require(changed==['param/tri-young-mod.bin'],'Material controls changed beyond Young.')
   for p in ['info.toml','param.toml']:require(z.read('native-cache/sessions/cpu-garment-soft/session/'+p)==z.read('native-cache/sessions/cpu-garment-stiff/session/'+p),'Material metadata differs.')
  raw_frame_hashes={name:[hashlib.sha256(z.read(f'native-cache/sessions/cpu-garment-{name}/session/output/vert_{i}.bin')).hexdigest() for i in range(len(frames[name]))] for name in cases}
  identical_raw=sum(z.read(f'native-cache/sessions/cpu-garment-soft/session/output/vert_{i}.bin')==z.read(f'native-cache/sessions/cpu-garment-stiff/session/output/vert_{i}.bin') for i in range(min(map(len,frames.values()))))
  reference=Path(__file__).with_name('results')/'garment-relaxation-native.zip'
  reference_raw=reference.read_bytes()
  require(hashlib.sha256(reference_raw).hexdigest()=='34e09c388d09e2e76b4962da84042f6dc1fd78ec7382a50c9e4447045bda3cdb','Changed original material reference.')
  with zipfile.ZipFile(io.BytesIO(reference_raw)) as ref:
   for name in cases:
    prefix=f'native-cache/sessions/cpu-garment-{name}/session/'
    require(prefix+'dyn_param.txt' not in ref.namelist(),'Unexpected reference schedule.')
    reference_bins={n[len(prefix+'bin/'):]:ref.read(n) for n in ref.namelist() if n.startswith(prefix+'bin/')}
    require(bins[name]==reference_bins,'Native inputs changed from original one-second material reference.')
    for meta in ['info.toml','param.toml']:
     reference=ref.read(prefix+meta)
     if longer and meta=='param.toml':reference=reference.replace(b'frames = 60',b'frames = 180')
     require(z.read(prefix+meta)==reference,'Reference scene/session metadata differs beyond declared frame limit.')
  canonical_path=Path(__file__).with_name('results')/'garment-canonical-one.zip'
  canonical_raw=canonical_path.read_bytes();require(hashlib.sha256(canonical_raw).hexdigest()=='694137f6ba4e64d4ef7412b9a114f41b753ea5c686555aae827b5b5b8ba5c23c','Changed canonical500 comparison archive.')
  with zipfile.ZipFile(io.BytesIO(canonical_raw)) as ref:
   canonical_equal=sum(z.read(f'native-cache/sessions/cpu-garment-soft/session/output/vert_{i}.bin')==ref.read(f'native-cache/sessions/cpu-garment-first/session/output/vert_{i}.bin') for i in range(61))
  prefixes=None
  if longer:
   prefixes={}
   ref_raw=Path(__file__).with_name('results').joinpath(f'garment-material-{profile}.zip').read_bytes()
   require(hashlib.sha256(ref_raw).hexdigest()==PROFILES[profile][0],'Changed one-second repaired material reference.')
   with zipfile.ZipFile(io.BytesIO(ref_raw)) as ref:
    for name in cases:
     prefix=f'native-cache/sessions/cpu-garment-{name}/session/'
     require({n[len(prefix+'bin/'):]:ref.read(n) for n in ref.namelist() if n.startswith(prefix+'bin/')}==bins[name],'Repaired duration study changed native physical inputs.')
     prefixes[name]=sum(z.read(prefix+f'output/vert_{i}.bin')==ref.read(prefix+f'output/vert_{i}.bin') for i in range(61))
  from garment_motion_windows import saved_motion_windows
  for name in cases:
   full,tail=divmod(len(frames[name])-1,60);windows=saved_motion_windows(frames[name][:full*60+1]) if full else []
   if tail:
    window=saved_motion_windows(frames[name][full*60:],1/60,tail)[0];window['start_seconds']+=full;window['end_seconds']+=full;windows.append(window)
   diagnostics[name]['saved_motion_windows']=windows
  for name in cases:diagnostics[name]['endpoint']=endpoint_diagnostics(inputs,frames[name],1/60)
  common_count=min(map(len,frames.values()))
  result={'archive_sha256':digest,'archive_bytes':len(raw),'artifact_id':artifact_id,'source_commit':'f844c08d9a1a0c2d922d0495513d74f09e61ece4' if longer else 'a340f5d18ac5b2b7eaf50eb0c73d750fe2fd7907','observation':observation,'one_second_prefix_identical_raw_frames':prefixes,'run_url':'https://github.com/twangyal/projects-monorepo/actions/runs/'+('39243425408' if longer else '39241347732'),'research_patch':patch,'native_files_verified':len(paths),'only_changed_material_bin':changed,'original_material_reference_inputs_identical':True,'canonical500_control_identical_raw_frames':canonical_equal,'requested_execution_settings':settings,'host':host,'cases':diagnostics,'identical_raw_frames':identical_raw,'raw_frame_sha256':raw_frame_hashes,'trajectory':trajectory_comparison(frames['soft'][:common_count],frames['stiff'][:common_count]),'supervisor':supervisor,'limits':['One pair per requested environment on separate hosts does not isolate causal thread effects.','Young is a normalized solver parameter, not a calibrated physical fabric; this cohort supplies no population tolerance.','Endpoint collar/shirt threshold counts include stitched neighborhoods and do not reproduce native contact-policy filtering; final snapshots/secants do not establish continuous contact or instantaneous velocity.','No settling, seam-quality, physical fit or backend adoption acceptance.']}
  if longer:result.update(native_outcome=r['status'],two_material_bounded_motion_complete=passed,completed_cases=list(r['cases']),trajectory_common_prefix_frames=common_count,final_saved_time_seconds={name:(len(frames[name])-1)/60 for name in cases},duration_scope='Complete pair' if passed else 'Timed-out pair: full soft case and partial stiff case; pair trajectory covers only their common saved prefix.')
  return result

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('archive',type=Path);p.add_argument('--profile',choices=list(PROFILES),required=True);p.add_argument('--observation',choices=['one-second','three-second'],default='one-second');a=p.parse_args();print(json.dumps(audit(a.archive,profile=a.profile,observation=a.observation),indent=2,allow_nan=False))
