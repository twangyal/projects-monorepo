"""Replay actual cleared native garment evidence; never load session pickles."""
import argparse,gzip,hashlib,io,json,math,struct,zipfile
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
ARCHIVE_SHA256='b7f56acb8951be51fde54aa734c08ead3555fea83ebb0b6305f052b7cb1b255e'
SOURCE_SHA256={'garment_native_probe.py':'4589d547787ab773bf540d9119f82de0d5a264e30f8cae62a5437ab9b66d299d','garment_native_inputs.py':'7fabcff5d5a36e5ab296d20f7078a1c686ed5ec1e9ae2deaf13406134c3d56d6','garment_native_export.py':'8d1a47315f1cbc4835694221c9fe409637cb62344a62566631c31dbe933047b3','garment_native_initialization.py':'4da3fc8f8af9d876f6cb887e84664e119da3f677a26a3115d324f8281fbc6e36','garment_sewing_layout.py':'8ee248b675dc46cb6c0c141147100f99a6170dddbc9620ce11b6178cec0bf8a2','garment_mass.py':'59e34d8be29738250be5c3ff0519bb269ccf1203a5ee6d51378562fe352fc2c9','garment_warm_start.py':'7666350062cc8a3a94a172d19247ea27f8185bc1822396ae0c2ba233cf2ac25b','garment_clearance.py':'ff815927bf8af70617cc5b74fffa8b7b135784998f1111f7f2bb180d42e0b7e1','garment_admission.py':'290c744289b0cdb3789adaaec7647502742843b9d2cb0882e13b29e993c5ced2'}

def rebuild(root):
 original=load_inputs(root);warm,wp=prepare(original,load_warm_start(root),root)
 body=json.loads(gzip.decompress((root/'garment-first.json.gz').read_bytes()))['packet']['body']
 candidate,cp=outward_preparation(warm,body);candidate,layout=sewing_layout(candidate)
 cp['surface_admission']=surface_clearance(candidate,REQUIRED_CLEARANCE_M)
 require(cp['surface_admission']['violations']==0,'Rebuilt pose is not clear.')
 inputs,mass=match_browser_inertia(original,candidate,root)
 return original,inputs,wp,cp,layout,mass

def audit(path,verify_archive_hash=True):
 raw=path.read_bytes() if isinstance(path,Path) else path.read();digest=hashlib.sha256(raw).hexdigest()
 if verify_archive_hash:require(digest==ARCHIVE_SHA256,'Changed cleared native archive.')
 original,inputs,wp,cp,layout,mass=rebuild(Path(__file__).with_name('results'))
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  r=json.loads(z.read('receipt.json'));paths=verify_manifest(z,r)
  require(json.loads(gzip.decompress(z.read('native-blueprint-original.json.gz')))==original,'Changed original blueprint.')
  require(json.loads(gzip.decompress(z.read('native-blueprint.json.gz')))==inputs,'Changed cleared blueprint.')
  controls={**OBJECT,'contact-offset':CLOTH_OFFSET_M}
  expected={'experiment':'actual-garment-native-clear-warm-sewing-v1','upstream_revision':REVISION,'source_sha256':SOURCE_SHA256,'source_artifact_sha256':inputs['source_artifact_sha256'],'object_parameters':controls,'body_contact_offset_m':BODY_OFFSET_M,'initialization':'clear-warm-sewing','initialization_parameters':layout,'warm_start_parameters':wp,'clearance_preparation':cp,'mass_convention':'browser-inertia','mass_parameters':mass,'session_parameters':SESSION,'case_normalized_young':CASES,'frames_per_case':19,'case_names':list(CASES),'case_session_prefix':'cpu-garment-'}
  for k,v in expected.items():require(r.get(k)==v,'Changed cleared receipt '+k)
  require(z.read('upstream-revision.txt').decode().strip()==REVISION and not z.read('upstream-initial-status.txt').strip(),'Changed/dirty upstream source.')
  require('Exit status: 0' in z.read('build-resources.txt').decode(),'Native build did not pass.')
  supervisor=json.loads(z.read('supervisor.json'));require(supervisor['remaining_children']==0 and supervisor['wall_limit_seconds']==300,'Unbounded/incomplete native cleanup.')
  passed=r['status']=='passed_garment_motion_probe'
  require((passed and r['stage']=='completed' and r['fixture_step_outcome']=='success' and r['fixture_exit_code']==0 and supervisor['status']=='completed' and supervisor['exit_code']==0) or (not passed and r['status'] in ['failed_garment_admission','timed_out'] and r['fixture_step_outcome']=='failure' and r['fixture_exit_code'] in [1,124] and supervisor['status'] in ['failed','timed_out']),'Inconsistent native outcome.')
  require(z.read('fixture-exit-code.txt').strip()==str(r['fixture_exit_code']).encode(),'Fixture exit record differs.')
  admitted=r.get('native_input_admission',{});require(list(admitted) in [[],['soft'],['soft','stiff']],'Unexpected native case order.')
  diagnostics={};bins={};frames={}
  expected_initial=tuple(struct.unpack('<f',struct.pack('<f',v))[0] for p in inputs['initial'] for v in p)
  for name in admitted:
   prefix=f'native-cache/sessions/cpu-garment-{name}/session/'
   require(verify_export(lambda p:z.read(prefix+p),inputs,CASES[name],object_parameters=controls,body_contact_offset=BODY_OFFSET_M)==admitted[name],'Native export admission differs.')
   found={p for p in paths if p.startswith(prefix+'output/vert_') and p.endswith('.bin')}
   count=len(found);require(1<=count<=19 and found=={prefix+f'output/vert_{i}.bin' for i in range(count)},'Missing/extra/noncontiguous raw frames.')
   frames[name]=[]
   for i in range(count):
    data=z.read(prefix+f'output/vert_{i}.bin');require(len(data)==7059*4,'Wrong raw frame size.');values=struct.unpack('<7059f',data);require(all(math.isfinite(v) for v in values),'Nonfinite raw frame.')
    if i==0:require(values==expected_initial,'Initial native frame differs.')
    frames[name].append([list(values[j:j+3]) for j in range(0,len(values),3)])
   timing=[line.split() for line in z.read(prefix+'output/data/frame_to_time.out').decode().splitlines() if line.strip()]
   require(len(timing)==count and all(len(row)==2 and int(row[0])==i and math.isfinite(float(row[1])) and math.isclose(float(row[1]),i/60,abs_tol=1e-12,rel_tol=0) for i,row in enumerate(timing)),'Changed saved frame timing.')
   completed=name in r['cases']
   if completed:
    require(count==19 and r['cases'][name]['frames']==19 and r['cases'][name]['vertices']==2353 and b'simulation finished' in z.read(prefix+'stdout.log') and not z.read(prefix+'error.log').strip(),'Case completion not supported by native output.')
   reduction=native_mass_reduction(lambda p:z.read(prefix+p));reported=[float(v) for v in z.read(prefix+'output/data/total_mass.out').decode().split()]
   require(len(reported)==3 and all(math.isfinite(v) for v in reported) and reported[0]==reported[2]==0 and math.isclose(reported[1],reduction['ordered_float32_diagnostic_mass_kg'],abs_tol=2e-8,rel_tol=0),'Native mass diagnostic differs.')
   require(math.isclose(reduction['accurate_face_mass_kg'],mass['captured_browser_total_mass_kg'],rel_tol=1e-5),'Native physical mass differs from captured mass.')
   diagnostics[name]={'raw_frames':count,'motion_frames':count-1,'completed_case':completed,'mass_reduction':reduction,'reported_mass_kg':reported[1],'metrics':measure(inputs,frames[name]) if count>1 else None}
   if count>1 and completed:require(diagnostics[name]['metrics']['maximum_vertex_displacement_m']>1e-6 and math.isclose(diagnostics[name]['metrics']['maximum_vertex_displacement_m'],r['cases'][name]['maximum_displacement_m'],rel_tol=1e-6),'Saved movement differs.')
   bins[name]={p[len(prefix+'bin/'):]:z.read(p) for p in paths if p.startswith(prefix+'bin/')}
  require(set(r['cases'])<=set(admitted),'Completed case was not admitted.')
  if passed:require(set(r['cases'])==set(CASES) and b'cpu actual garment motion probe: PASS' in z.read('fixture.log'),'Missing two-material completion.')
  changed=None;rms=None
  if set(bins)==set(CASES):
   require(set(bins['soft'])==set(bins['stiff']),'Material bin names differ.')
   changed=sorted(p for p in bins['soft'] if bins['soft'][p]!=bins['stiff'][p]);require(changed==['param/tri-young-mod.bin'],'Material controls differ beyond Young.')
   for p in ['info.toml','param.toml']:require(z.read('native-cache/sessions/cpu-garment-soft/session/'+p)==z.read('native-cache/sessions/cpu-garment-stiff/session/'+p),'Material metadata differs.')
   if passed:rms=math.sqrt(sum(math.dist(p,q)**2 for p,q in zip(frames['soft'][-1],frames['stiff'][-1]))/2353)
  return {'archive_sha256':digest,'archive_bytes':len(raw),'source_commit':'1e941a42cd8154558566f89ca537eca690da9952','run_url':'https://github.com/twangyal/projects-monorepo/actions/runs/39179647279','native_status':r['status'],'stage':r['stage'],'two_material_bounded_motion_complete':passed,'native_files_verified':len(paths),'clearance_preparation':cp,'initialization_parameters':layout,'cases':diagnostics,'only_changed_material_bin':changed,'final_material_vertex_rms_difference_m':rms,'supervisor':supervisor,'limits':['Initial cloth/body clearance only; self-contact/trajectory acceptance is separate.','Bounded saved motion is not settling, seam-quality, calibrated material, physical fit or engine adoption.']}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('archive',type=Path);a=p.parse_args();print(json.dumps(audit(a.archive),indent=2,allow_nan=False))
