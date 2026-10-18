"""Replay checksum-pinned warm-preparation failure; never load session pickles."""
import argparse,gzip,hashlib,io,json,math,struct,zipfile
from pathlib import Path
from bending_audit import verify_manifest
from garment_admission import require
from garment_native_inputs import load_inputs,REVISION,OBJECT,SESSION,CASES
from garment_native_initialization import CLOTH_OFFSET_M,BODY_OFFSET_M
from garment_native_export import verify_export
from garment_sewing_layout import sewing_layout
from garment_mass import match_browser_inertia
from garment_warm_start import prepare,load_warm_start
ARCHIVE_SHA256='53acab060975ff61ac5d3f9db404ee20ddb5a3adf829653fa503aa2f65d1e7a2'
UNSEWN_ARCHIVE_SHA256='ad57036c4e90094995ff7355be9039013b7d891611aaf56adf82cd557ab0ad08'
SOURCE_SHA256={'garment_native_probe.py':'afb2a300b53ebc2d165aac9c1bb06355e14a1b19f31b1987c5004ae69dd68b90','garment_native_inputs.py':'7fabcff5d5a36e5ab296d20f7078a1c686ed5ec1e9ae2deaf13406134c3d56d6','garment_native_export.py':'500910527f5083d80277a0ce8ec3d82e1d20e4932dff714ee20d50e395d951a5','garment_native_initialization.py':'4da3fc8f8af9d876f6cb887e84664e119da3f677a26a3115d324f8281fbc6e36','garment_sewing_layout.py':'8ee248b675dc46cb6c0c141147100f99a6170dddbc9620ce11b6178cec0bf8a2','garment_mass.py':'59e34d8be29738250be5c3ff0519bb269ccf1203a5ee6d51378562fe352fc2c9','garment_warm_start.py':'7666350062cc8a3a94a172d19247ea27f8185bc1822396ae0c2ba233cf2ac25b'}
def closest_triangle_point(p,a,b,c):
 def sub(a,b):return tuple(x-y for x,y in zip(a,b))
 def dot(a,b):return sum(x*y for x,y in zip(a,b))
 def line(a,b,t):return tuple(x+t*(y-x) for x,y in zip(a,b))
 ab,ac,ap=sub(b,a),sub(c,a),sub(p,a);d1,d2=dot(ab,ap),dot(ac,ap)
 if d1<=0 and d2<=0:return a
 bp=sub(p,b);d3,d4=dot(ab,bp),dot(ac,bp)
 if d3>=0 and d4<=d3:return b
 vc=d1*d4-d3*d2
 if vc<=0 and d1>=0 and d3<=0:return line(a,b,d1/(d1-d3))
 cp=sub(p,c);d5,d6=dot(ab,cp),dot(ac,cp)
 if d6>=0 and d5<=d6:return c
 vb=d5*d2-d1*d6
 if vb<=0 and d2>=0 and d6<=0:return line(a,c,d2/(d2-d6))
 va=d3*d6-d5*d4
 if va<=0 and d4-d3>=0 and d5-d6>=0:return line(b,c,(d4-d3)/((d4-d3)+(d5-d6)))
 v,w=vb/(va+vb+vc),vc/(va+vb+vc)
 return tuple(a[i]+ab[i]*v+ac[i]*w for i in range(3))

def initial_contact_witness(inputs,stdout):
 require('vertices 2282 and 1198' in stdout and 'squared separation 1.068118e-05 against offset 3.500000e-03' in stdout,'Missing reported initial contact witness.')
 require(inputs['faces'][4351]==[2282,2275,2283],'Changed reported face mapping.')
 f=lambda v:struct.unpack('<f',struct.pack('<f',v))[0]
 point=tuple(map(f,inputs['body_vertices'][1198]));triangle=[tuple(map(f,inputs['initial'][i])) for i in inputs['faces'][4351]]
 separation=math.dist(point,closest_triangle_point(point,*triangle));corners=[math.dist(point,v) for v in triangle]
 require(math.isclose(separation**2,1.068118e-5,rel_tol=2e-6) and separation<CLOTH_OFFSET_M+BODY_OFFSET_M and min(corners)>CLOTH_OFFSET_M+BODY_OFFSET_M,'Reported contact witness did not reproduce.')
 return {'static_vertex':1198,'dynamic_triangle':4351,'dynamic_vertices':inputs['faces'][4351],'face_source':inputs['face_source'][4351],'coordinate_convention':'float32-rounded native input positions; float64 closest-point calculation','triangle_separation_m':separation,'vertex_pair_separations_m':corners,'combined_contact_offset_m':CLOTH_OFFSET_M+BODY_OFFSET_M,'offset_shortfall_m':CLOTH_OFFSET_M+BODY_OFFSET_M-separation,'scope':'One independently reproduced initial triangle-interior barrier violation, not exhaustive contact clearance or physical fit.'}

def audit(path,verify_archive_hash=True,unsewn_control=False):
 raw=path.read_bytes() if isinstance(path,Path) else path.read();digest=hashlib.sha256(raw).hexdigest()
 if verify_archive_hash:require(digest==(UNSEWN_ARCHIVE_SHA256 if unsewn_control else ARCHIVE_SHA256),'Changed warm failure archive.')
 root=Path(__file__).with_name('results');original=load_inputs(root)
 warm,preparation=prepare(original,load_warm_start(root),root);prepared,layout=sewing_layout(warm);inputs,mass=match_browser_inertia(original,prepared,root)
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  receipt=json.loads(z.read('receipt.json'));paths=verify_manifest(z,receipt)
  require(json.loads(gzip.decompress(z.read('native-blueprint-original.json.gz')))==original,'Changed original blueprint.')
  require(json.loads(gzip.decompress(z.read('native-blueprint.json.gz')))==inputs,'Changed prepared blueprint.')
  controls={**OBJECT,'contact-offset':CLOTH_OFFSET_M}
  sources=SOURCE_SHA256
  if unsewn_control:
   controls['stitch-stiffness']=0.
   sources={**SOURCE_SHA256,'garment_native_probe.py':'2dae173c149102c219201039f818939de5ecf7f0b221ee8abc2d6e2d37df2c29','garment_native_export.py':'8d1a47315f1cbc4835694221c9fe409637cb62344a62566631c31dbe933047b3'}
  expected={'status':'failed_garment_admission','stage':'native_execution','experiment':'actual-garment-native-warm-sewing-v1','upstream_revision':REVISION,'source_sha256':sources,'source_artifact_sha256':inputs['source_artifact_sha256'],'object_parameters':controls,'body_contact_offset_m':BODY_OFFSET_M,'initialization':'warm-sewing','initialization_parameters':layout,'warm_start_parameters':preparation,'mass_convention':'browser-inertia','mass_parameters':mass,'session_parameters':SESSION,'case_normalized_young':CASES,'fixture_step_outcome':'failure','fixture_exit_code':1,'frames_per_case':19,'case_names':list(CASES),'cases':{},'current_case':'soft','case_session_prefix':'cpu-garment-','error_type':'RuntimeError'}
  if unsewn_control:expected.update(experiment='actual-garment-native-warm-sewing-v1-unsewn-control',unsewn_control=True)
  for key,value in expected.items():require(receipt.get(key)==value,'Unexpected failure receipt '+key)
  require(z.read('upstream-revision.txt').decode().strip()==REVISION and not z.read('upstream-initial-status.txt').strip(),'Changed/dirty upstream source.')
  require('Exit status: 0' in z.read('build-resources.txt').decode() and z.read('fixture-exit-code.txt').strip()==b'1','Unexpected build/fixture result.')
  supervisor=json.loads(z.read('supervisor.json'));require(supervisor['status']=='failed' and supervisor['exit_code']==1 and supervisor['remaining_children']==0 and supervisor['wall_limit_seconds']==300,'Unexpected supervisor result.')
  prefix='native-cache/sessions/cpu-garment-soft/session/'
  require(len(paths)==82 and all(p.startswith(prefix) for p in paths),'Unexpected/incomplete native sessions.')
  admission=verify_export(lambda p:z.read(prefix+p),inputs,CASES['soft'],object_parameters=controls,body_contact_offset=BODY_OFFSET_M)
  require(receipt['native_input_admission']=={'soft':admission},'Changed native admission.')
  frames={p for p in paths if '/output/vert_' in p and p.endswith('.bin')}
  require(frames=={prefix+'output/vert_0.bin'},'Unexpected initial/motion frames.')
  values=struct.unpack('<7059f',z.read(prefix+'output/vert_0.bin'))
  expected_values=tuple(struct.unpack('<f',struct.pack('<f',v))[0] for point in inputs['initial'] for v in point)
  require(all(math.isfinite(v) for v in values) and values==expected_values,'Changed/nonfinite native initial frame.')
  require(z.read(prefix+'output/data/frame_to_time.out').strip()==b'0 0','Unexpected saved motion time.')
  require('failed to advance' in z.read(prefix+'error.log').decode() and 'failed to advance' in receipt['error'],'Missing first-advance failure.')
  require(b'simulation finished' not in z.read(prefix+'stdout.log') and b'cpu actual garment motion probe: PASS' not in z.read('fixture.log'),'Unexpected completion claim.')
  witness=initial_contact_witness(inputs,z.read(prefix+'stdout.log').decode())
  result={'initial_contact_witness':witness,'archive_sha256':digest,'archive_bytes':len(raw),'source_commit':'e694571c86f17b2627c3b507a79b5c43deaf34d5','run_url':'https://github.com/twangyal/projects-monorepo/actions/runs/39157200184','result':'strict_initialization_and_export_admitted_first_advance_failed','native_files_verified':len(paths),'raw_frames':1,'motion_frames':0,'finite_initial_coordinates':len(values),'native_input_admission':admission,'warm_start_parameters':preparation,'initialization_parameters':layout,'supervisor':supervisor,'limits':['No material comparison, motion, settling, contact trajectory or physical-fit acceptance.','Emitted clearance/stitch hint does not isolate a root cause.','The prepared collar starts about296mm from its sewing targets.']}
  if unsewn_control:
   baseline=audit(root/'garment-warm-native-failure.zip')
   require(baseline['initial_contact_witness']==witness,'Unsewn contact witness differs.')
   with zipfile.ZipFile(root/'garment-warm-native-failure.zip') as base:
    bin_prefix=prefix+'bin/'
    names={p for p in paths if p.startswith(bin_prefix)}
    require(names=={p for p in base.namelist() if p.startswith(bin_prefix)},'Paired native input name sets differ.')
    changed=sorted(p[len(bin_prefix):] for p in names if z.read(p)!=base.read(p))
    require(changed==['stitch_stiffness.bin'],'Paired input control differs beyond stitch stiffness.')
    for name in ['info.toml','param.toml']:require(z.read(prefix+name)==base.read(prefix+name),'Paired native metadata differs.')
   result.update(source_commit='e7bc7a70178edfe023072b681b90e7facf83d1c5',run_url='https://github.com/twangyal/projects-monorepo/actions/runs/39158906691',only_changed_native_bin=changed,paired_sewn_archive_sha256=ARCHIVE_SHA256,failure_reproduced_without_stitch_forces=True)
  return result
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);parser.add_argument('--unsewn-control',action='store_true');args=parser.parse_args();print(json.dumps(audit(args.archive,unsewn_control=args.unsewn_control),indent=2,allow_nan=False))
