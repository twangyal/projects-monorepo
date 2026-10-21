"""Replay separate fixed-material native sessions; not serial-pair completion or fit."""
import argparse,gzip,hashlib,io,json,math,struct,zipfile
from pathlib import Path
from bending_audit import verify_manifest
from garment_admission import require
from garment_archive_storage import read_archive
from garment_native_inputs import REVISION,OBJECT,SESSION,CASES
from garment_native_initialization import CLOTH_OFFSET_M,BODY_OFFSET_M
from garment_native_export import verify_export
from garment_motion import measure
from garment_inertia_audit import native_mass_reduction
from garment_clearance_audit import LONG_SOURCE_SHA256
from garment_endpoint_diagnostics import endpoint_diagnostics

from garment_repeatability_audit import COMMAND,THREAD_VARIABLES,prepared_inputs
# Registered only after official native artifacts are retained; no synthetic pass.
PROFILES={
 'one-soft':('17e59a70605c1abcec179be032021ef76431bfacc52240474878969d8a7adc1a',1,'soft',12203356627),
 'one-stiff':('1ea8c42c24277701aeb88289c5d67c81c4947e53e7926475f9b6fc8ff5c8c5d4',1,'stiff',12202742689),
 'four-soft':('fc2c0de508864f468b7a8669de0bcf2309db3c57611c02e6e46a280476a6bf70',4,'soft',12201778448),
 'four-stiff':('7253736fa219c7b95a92852fb063a0a1d8b131fffa082646c87ad17159eda591',4,'stiff',12203270919),
}
SOURCE_SHA256={**LONG_SOURCE_SHA256,'garment_native_probe.py':'0e4adc0bafe8c3d5894973d164d162cedc68ae7f309526a39e11d7b202d67bd4','garment_native_export.py':'b471efece350968ed8629dbadb635f50798615892ddde7572f6591558ba59209'}
HALF_STEP_PROFILES={
 'four-soft':('d7d21b4a32e8c704f984acef63f97565f881da90892d343cf194c77ec1fd5522',4,'soft',12223087980),
 'four-stiff':('03fc96f2c89c7d9fa6de056976ba919b3b2797a47c4cb2759037b04c5f183032',4,'stiff',12222529007),
}
HALF_STEP_SOURCE_SHA256={**LONG_SOURCE_SHA256,'garment_native_probe.py':'c94a54d879b552587912e1ee469b05a16946a5dacf1123362d9920af27701c8f','garment_native_export.py':'86a552a227f0cf030a57a4ab0bc823a46a7beedecf9de86dae322d73e2081cb9'}
GRAVITY_PROFILES={} # Register only retained official native artifacts.
GRAVITY_SOURCE_SHA256={**LONG_SOURCE_SHA256,**{'garment_native_probe.py': '7495865e1e4426efb3c32bd1931559cb316472d00f680102b89196d8ae5bcc22', 'garment_native_export.py': '7ba442a049ffda77eaa8f8e23dde0e356d2961d7d544621e2d575b4e5b76dccc'}}
def audit(path,verify_archive_hash=True,profile=None,protocol='fixed-material'):
 require(protocol in ['fixed-material','half-step','gravity'],'Unknown study protocol.')
 half=protocol=='half-step';gravity=protocol=='gravity';registry=GRAVITY_PROFILES if gravity else HALF_STEP_PROFILES if half else PROFILES
 require(profile in registry,'Unknown fixed-material profile.')
 archive_hash,threads,name,artifact_id=registry[profile]
 if half:require(threads==4,'Half-step requires requested-four environment.')
 if gravity:require(threads==4 and name=='soft' and profile in ('reference','zero'),'Gravity protocol requires declared fixed soft requested-four controls.')
 sources=GRAVITY_SOURCE_SHA256 if gravity else HALF_STEP_SOURCE_SHA256 if half else SOURCE_SHA256;frame_count=181;session={**SESSION,'frames':180,**({'dt':1/240} if half else {}),**({'gravity':[0.,0.,0.]} if gravity and profile=='zero' else {})};cases={name:CASES[name]}
 outcome={'status':'passed_garment_motion_probe','counts':{name:181},'completed':[name]}
 variables={key:str(threads) for key in THREAD_VARIABLES}
 settings={'requested_threads':threads,'variables':variables,'scope':'Requested inherited environment, not a measurement of actual native worker counts.'}
 raw=read_archive(path);digest=hashlib.sha256(raw).hexdigest()
 if verify_archive_hash:require(isinstance(archive_hash,str) and digest==archive_hash,'Changed fixed-material native archive.')
 original,inputs,wp,cp,layout,mass=prepared_inputs()
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  from garment_mesh_patch_evidence import verify_research_patch
  patch=verify_research_patch(z)
  r=json.loads(z.read('receipt.json'));paths=verify_manifest(z,r)
  if gravity:require(r.get('gravity_study')==profile,'Changed explicit gravity mode.')
  else:require('gravity_study' not in r,'Unexpected gravity flag.')
  if half:require(r.get('half_step_study') is True,'Missing explicit half-step flag.')
  else:require('half_step_study' not in r,'Unexpected half-step flag.')
  require(not any(k in r for k in ['same_material_control','unsewn_control','relaxation_study']),'Unexpected same-material/unsewn receipt controls.')
  require({p.split('/')[2] for p in paths if p.startswith('native-cache/sessions/')}=={'cpu-garment-'+name},'Unexpected native session namespace.')
  require(r.get('fixed_material_study')==name and r.get('execution_settings')==settings,'Changed fixed-material settings.')
  require(json.loads(gzip.decompress(z.read('native-blueprint-original.json.gz')))==original,'Changed original blueprint.')
  require(json.loads(gzip.decompress(z.read('native-blueprint.json.gz')))==inputs,'Changed cleared blueprint.')
  controls={**OBJECT,'contact-offset':CLOTH_OFFSET_M}
  expected={'experiment':'actual-garment-native-clear-warm-sewing-v1-fixed-material-study'+('-gravity-study' if gravity else '-half-step-study' if half else ''),'upstream_revision':REVISION,'source_sha256':sources,'source_artifact_sha256':inputs['source_artifact_sha256'],'object_parameters':controls,'body_contact_offset_m':BODY_OFFSET_M,'initialization':'clear-warm-sewing','initialization_parameters':layout,'warm_start_parameters':wp,'clearance_preparation':cp,'mass_convention':'browser-inertia','mass_parameters':mass,'session_parameters':session,'case_normalized_young':cases,'frames_per_case':frame_count,'case_names':list(cases),'case_session_prefix':'cpu-garment-'}
  for k,v in expected.items():require(r.get(k)==v,'Changed cleared receipt '+k)
  require(z.read('upstream-revision.txt').decode().strip()==REVISION and not z.read('upstream-initial-status.txt').strip(),'Changed/dirty upstream source.')
  require('Exit status: 0' in z.read('build-resources.txt').decode(),'Native build did not pass.')
  supervisor=json.loads(z.read('supervisor.json'));require(supervisor['remaining_children']==0 and supervisor['wall_limit_seconds']==300,'Unbounded/incomplete native cleanup.')
  passed=r['status']=='passed_garment_motion_probe'
  require(r['status']==outcome['status'] and list(r['cases'])==outcome['completed'],'Changed frozen native outcome; partial motion is not completion.')
  require(passed and r['stage']=='completed' and r['fixture_step_outcome']=='success' and r['fixture_exit_code']==0 and supervisor['status']=='completed' and supervisor['exit_code']==0,'Fixed-material session did not complete successfully.')
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
   require(verify_export(lambda p:z.read(prefix+p),inputs,cases[name],object_parameters=controls,body_contact_offset=BODY_OFFSET_M,session_parameters=session,half_step_study=half,gravity_study=profile if gravity else None)==admitted[name],'Native export admission differs.')
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
  if passed:require(set(r['cases'])==set(cases) and b'cpu actual garment motion probe: PASS' in z.read('fixture.log'),'Missing fixed-material completion.')
  raw_hashes=[hashlib.sha256(z.read(f'native-cache/sessions/cpu-garment-{name}/session/output/vert_{i}.bin')).hexdigest() for i in range(frame_count)]
  from garment_material_cohort_audit import DURATION_PROFILES
  comparisons={}
  for reference_profile in ['one','four']:
   reference_path=Path(__file__).with_name('results')/f'garment-duration-{reference_profile}.zip.xz'
   reference_raw=read_archive(reference_path)
   require(hashlib.sha256(reference_raw).hexdigest()==DURATION_PROFILES[reference_profile][0],'Changed prior duration reference.')
   count=DURATION_PROFILES[reference_profile][3]['counts'][name]
   prefix=f'native-cache/sessions/cpu-garment-{name}/session/'
   with zipfile.ZipFile(io.BytesIO(reference_raw)) as ref:
    require({n[len(prefix+'bin/'):]:ref.read(n) for n in ref.namelist() if n.startswith(prefix+'bin/')}==bins[name],'Fixed session changed native physical inputs.')
    for meta in ['info.toml','param.toml']:
     expected_meta=ref.read(prefix+meta)
     if half and meta=='param.toml':
      require(expected_meta.count(b'dt = 0.008333333333333333')==1,'Unexpected reference dt metadata.')
      expected_meta=expected_meta.replace(b'dt = 0.008333333333333333',b'dt = 0.004166666666666667')
     if gravity and profile=='zero' and meta=='param.toml':
      require(expected_meta.count(b'-9.8')==1,'Unexpected reference gravity metadata.')
      expected_meta=expected_meta.replace(b'-9.8',b'0.0')
     require(z.read(prefix+meta)==expected_meta,'Changed reference metadata.')
    if half and reference_profile=='four':
     reference_frames=[]
     for i in range(count):
      values=struct.unpack('<7059f',ref.read(prefix+f'output/vert_{i}.bin'))
      reference_frames.append([list(values[j:j+3]) for j in range(0,len(values),3)])
     from garment_repeatability_audit import trajectory_comparison
     reference_trajectory=trajectory_comparison(frames[name],reference_frames)
    reference_hashes=[hashlib.sha256(ref.read(prefix+f'output/vert_{i}.bin')).hexdigest() for i in range(count)]
    comparisons[reference_profile]={'available_reference_frames':count,'identical_raw_frames':sum(a==b for a,b in zip(raw_hashes,reference_hashes)),'all_available_frames_identical':raw_hashes[:count]==reference_hashes}
  from garment_motion_windows import saved_motion_windows
  diagnostics[name]['saved_motion_windows']=saved_motion_windows(frames[name])
  diagnostics[name]['endpoint']=endpoint_diagnostics(inputs,frames[name],1/60)
  from garment_construction_diagnostics import construction_diagnostics
  diagnostics[name]['construction']=construction_diagnostics(inputs,frames[name][-1])
  result={'archive_sha256':digest,'archive_bytes':len(raw),'artifact_id':artifact_id,'fixed_material':name,'normalized_young':cases[name],'native_outcome':r['status'],'fixed_material_bounded_motion_complete':True,'original_timed_out_serial_pair_completed':False,'native_files_verified':len(paths),'research_patch':patch,'requested_execution_settings':settings,'host':host,'case':diagnostics[name],'raw_frame_sha256':raw_hashes,'duration_reference_comparisons':comparisons,'supervisor':supervisor,'limits':['Separate300-second budget per fixed material, not completion within the original serial-pair budget.','One session per material/environment does not establish population determinism or causal thread effects.','Normalized coefficient is not calibrated physical fabric.','Saved endpoints/secants do not establish continuous-time contact, instantaneous velocity, sustained settling, physical fit or engine adoption.']}

  if gravity:
   from garment_principal_strain import principal_strain
   diagnostics[name]['principal_strain']=principal_strain(inputs,frames[name][-1])
   result.update(protocol='gravity',gravity_study=profile,gravity_m_per_s2=session['gravity'])
   result['limits'].append('Gravity-only diagnostic on one prepared fixture; does not isolate construction, bending, contact or initialization causes.')
  if half:
   from garment_principal_strain import principal_strain
   diagnostics[name]['principal_strain']=principal_strain(inputs,frames[name][-1])
   result.update(protocol='half-step',configured_dt_seconds=1/240,configured_dt_reference_seconds=1/120,reference_trajectory=reference_trajectory,reference_archive={'profile':'duration-four','archive_sha256':DURATION_PROFILES['four'][0],'artifact_id':DURATION_PROFILES['four'][2],'run_url':'https://github.com/twangyal/projects-monorepo/actions/runs/39243425408'},reference_principal_strain=principal_strain(inputs,reference_frames[-1]))
   result['limits'].append('Two configured step settings on separate hosts do not establish timestep convergence, causal step effects or physical accuracy.')
  return result

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('archive',type=Path);p.add_argument('--protocol',choices=['fixed-material','half-step','gravity'],default='fixed-material');p.add_argument('--profile',choices=sorted(set(PROFILES)|set(HALF_STEP_PROFILES)|set(GRAVITY_PROFILES)),required=True);a=p.parse_args();print(json.dumps(audit(a.archive,profile=a.profile,protocol=a.protocol),indent=2,allow_nan=False))
