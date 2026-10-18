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
SOURCE_SHA256={'garment_native_probe.py':'afb2a300b53ebc2d165aac9c1bb06355e14a1b19f31b1987c5004ae69dd68b90','garment_native_inputs.py':'7fabcff5d5a36e5ab296d20f7078a1c686ed5ec1e9ae2deaf13406134c3d56d6','garment_native_export.py':'500910527f5083d80277a0ce8ec3d82e1d20e4932dff714ee20d50e395d951a5','garment_native_initialization.py':'4da3fc8f8af9d876f6cb887e84664e119da3f677a26a3115d324f8281fbc6e36','garment_sewing_layout.py':'8ee248b675dc46cb6c0c141147100f99a6170dddbc9620ce11b6178cec0bf8a2','garment_mass.py':'59e34d8be29738250be5c3ff0519bb269ccf1203a5ee6d51378562fe352fc2c9','garment_warm_start.py':'7666350062cc8a3a94a172d19247ea27f8185bc1822396ae0c2ba233cf2ac25b'}
def audit(path,verify_archive_hash=True):
 raw=path.read_bytes() if isinstance(path,Path) else path.read();digest=hashlib.sha256(raw).hexdigest()
 if verify_archive_hash:require(digest==ARCHIVE_SHA256,'Changed warm failure archive.')
 root=Path(__file__).with_name('results');original=load_inputs(root)
 warm,preparation=prepare(original,load_warm_start(root),root);prepared,layout=sewing_layout(warm);inputs,mass=match_browser_inertia(original,prepared,root)
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  receipt=json.loads(z.read('receipt.json'));paths=verify_manifest(z,receipt)
  require(json.loads(gzip.decompress(z.read('native-blueprint-original.json.gz')))==original,'Changed original blueprint.')
  require(json.loads(gzip.decompress(z.read('native-blueprint.json.gz')))==inputs,'Changed prepared blueprint.')
  controls={**OBJECT,'contact-offset':CLOTH_OFFSET_M}
  expected={'status':'failed_garment_admission','stage':'native_execution','experiment':'actual-garment-native-warm-sewing-v1','upstream_revision':REVISION,'source_sha256':SOURCE_SHA256,'source_artifact_sha256':inputs['source_artifact_sha256'],'object_parameters':controls,'body_contact_offset_m':BODY_OFFSET_M,'initialization':'warm-sewing','initialization_parameters':layout,'warm_start_parameters':preparation,'mass_convention':'browser-inertia','mass_parameters':mass,'session_parameters':SESSION,'case_normalized_young':CASES,'fixture_step_outcome':'failure','fixture_exit_code':1,'frames_per_case':19,'case_names':list(CASES),'cases':{},'current_case':'soft','case_session_prefix':'cpu-garment-','error_type':'RuntimeError'}
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
  return {'archive_sha256':digest,'archive_bytes':len(raw),'source_commit':'e694571c86f17b2627c3b507a79b5c43deaf34d5','run_url':'https://github.com/twangyal/projects-monorepo/actions/runs/39157200184','result':'strict_initialization_and_export_admitted_first_advance_failed','native_files_verified':len(paths),'raw_frames':1,'motion_frames':0,'finite_initial_coordinates':len(values),'native_input_admission':admission,'warm_start_parameters':preparation,'initialization_parameters':layout,'supervisor':supervisor,'limits':['No material comparison, motion, settling, contact trajectory or physical-fit acceptance.','Emitted clearance/stitch hint does not isolate a root cause.','The prepared collar starts about296mm from its sewing targets.']}
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);args=parser.parse_args();print(json.dumps(audit(args.archive),indent=2,allow_nan=False))
