"""Collect native cache evidence outside the bounded fixture process, including timeouts."""
import argparse
import hashlib
import json
import re
from pathlib import Path
import shutil

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out',required=True,type=Path)
parser.add_argument('--cache',required=True,type=Path)
parser.add_argument('--outcome',required=True,choices=['success','failure','skipped','cancelled'])
args=parser.parse_args();out=args.out.resolve();cache=args.cache.resolve()
if out==cache or cache in out.parents:raise SystemExit('Evidence output must be outside the native cache.')
out.mkdir(parents=True,exist_ok=True);path=out/'receipt.json'
receipt=json.loads(path.read_text()) if path.is_file() else {'schema':1,'status':'not_executed'}
code_path=out/'fixture-exit-code.txt';code=int(code_path.read_text().strip()) if code_path.is_file() else None
receipt['fixture_step_outcome']=args.outcome;receipt['fixture_exit_code']=code
if code in [124,137]:receipt['status']='timed_out'
elif args.outcome!='success' and receipt['status']=='passed_upstream_fixture':receipt['status']='failed_execution_gate'
elif receipt['status']=='started':receipt['status']='interrupted'
supervisor=out/'supervisor.json'
if supervisor.is_file() and json.loads(supervisor.read_text()).get('remaining_children',0):
    receipt['status']='failed_cleanup'
    path.write_text(json.dumps(receipt,indent=2)+'\n')
    raise SystemExit('Refusing to collect changing evidence while native children remain.')
manifest=[]
if cache.is_dir():
    for source in sorted(cache.rglob('*')):
        if not source.is_file() or source.is_symlink():continue
        relative=source.relative_to(cache);target=out/'native-cache'/relative
        target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
        digest=hashlib.sha256()
        with source.open('rb') as stream:
            for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
        manifest.append({'path':str(Path('native-cache')/relative),'bytes':source.stat().st_size,'sha256':digest.hexdigest()})
receipt['retained_native_files']=manifest
expected=receipt.get('frames_per_case')
frames={item['path'] for item in manifest if re.fullmatch(r'native-cache/sessions/cpu-contact-(?:held|through)/session/output/vert_[0-9]+\.bin',item['path'])}
actual=len(frames)
required={f'native-cache/sessions/cpu-contact-{name}/session/output/vert_{i}.bin' for name in ['held','through'] for i in range(expected or 0)}
missing=receipt['status']=='passed_upstream_fixture' and expected is not None and frames!=required
if missing:
    receipt['status']='failed_evidence_collection'
    receipt['evidence_error']=f'Expected exact per-case output frame set ({expected*2} files), retained {actual} numeric output frames.'
path.write_text(json.dumps(receipt,indent=2,allow_nan=False)+'\n')
print(json.dumps({'status':receipt['status'],'native_files':len(manifest),'vertex_frames':actual}))
if missing:raise SystemExit(1)
