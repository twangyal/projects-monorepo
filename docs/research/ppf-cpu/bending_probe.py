"""Frozen synthetic CPU horizontal cantilever experiment; not physical fabric calibration.

Frontend conventions adapted from st-tech/ppf-contact-solver calibration/tensile (frontend API only)
at6b30976 (Claude Code; review Ryoichi Ando), Apache-2.0.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time
import traceback
from bending_metrics import strip,measure,admit,CASES,PARAMETERS,SESSION
REVISION='6b30976f86e6b94d68d459e5237d59704c7d1384'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ['upstream','out','cache']:parser.add_argument('--'+key,type=Path,required=True)
    args=parser.parse_args();upstream=args.upstream.resolve();out=args.out.resolve();cache=args.cache.resolve()
    out.mkdir(parents=True,exist_ok=True)
    if cache.exists() and any(cache.iterdir()):raise ValueError('Require empty dedicated synthetic cache.')
    cache.mkdir(parents=True,exist_ok=True)
    revision=subprocess.check_output(['git','-C',str(upstream),'rev-parse','HEAD'],text=True).strip()
    if revision!=REVISION:raise ValueError('Unpinned upstream.')
    receipt={'schema':1,'experiment':'cpu-normalized-bending-v1','status':'started','upstream_revision':revision,'backend':'cpu','frames_per_case':401,'case_names':list(CASES),'case_session_prefix':'cpu-bending-','cases':{},'source_sha256':{name:hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest() for name in ['bending_probe.py','bending_metrics.py']}}
    started=time.perf_counter()
    def save():(out/'receipt.json').write_text(json.dumps(receipt,indent=2,allow_nan=False)+'\n')
    save()
    try:
        sys.path.insert(0,str(upstream));os.chdir(upstream)
        import numpy as np
        from frontend import App
        original=App.get_data_dirpath;App.get_data_dirpath=staticmethod(lambda:str(cache/'sessions'))
        vertices,faces=strip();all_frames={}
        (out/'experiment-input.json').write_text(json.dumps({'vertices_m':vertices,'triangles':faces,'pinned_authored_indices':list(range(8)),'cases':CASES,'object_parameters':PARAMETERS,'session_parameters':SESSION},indent=2)+'\n')
        try:
            for name,coefficients in CASES.items():
                case_start=time.perf_counter();app=App.create('cpu-bending-'+name,cache_dir=str(cache/'meshes'))
                if not Path(app._root).resolve().is_relative_to(cache):raise ValueError('Session escaped dedicated cache.')
                app.asset.add.tri('strip',np.array(vertices,dtype=np.float64),np.array(faces,dtype=np.uint32))
                scene=app.scene.create();obj=scene.add('strip');obj.pin(list(range(8)))
                for key,value in {**PARAMETERS,**coefficients}.items():obj.param.set(key,value)
                fixed=scene.build();rest=np.asarray(fixed.vertex(True),dtype=np.float64)
                distance=np.linalg.norm(rest[:,None,:]-np.array(vertices)[None,:,:],axis=2);rows=np.argmin(distance,axis=0).tolist()
                if sorted(rows)!=list(range(44)) or max(distance[rows[i],i] for i in range(44))>1e-6:raise ValueError('Rest map is not bijective.')
                (out/(name+'-geometry.json')).write_text(json.dumps({'authored_to_solved':rows},indent=2)+'\n')
                session=app.session.create(fixed)
                for key,value in SESSION.items():session.param.set(key,value)
                session=session.build();session.start(blocking=True)
                if not session.finished():raise ValueError(name+': native process did not finish.')
                output=Path(session.output.path)
                if {p.name for p in output.glob('vert_*.bin')}!={f'vert_{i}.bin' for i in range(401)}:raise ValueError('Wrong frame set.')
                frames=[]
                for i in range(401):
                    raw=np.fromfile(output/f'vert_{i}.bin',dtype=np.float32)
                    if len(raw)!=132:raise ValueError('Wrong solved vertex namespace.')
                    frames.append(raw.reshape(-1,3)[rows].tolist())
                all_frames[name]=frames;receipt['cases'][name]=measure(frames,vertices)
                receipt['cases'][name]['native_wall_seconds']=time.perf_counter()-case_start;save()
                print(json.dumps({'case':name,'metrics':receipt['cases'][name]}),flush=True)
            save();admit(receipt['cases']);receipt['status']='passed_bending_fixture';print('cpu bending fixture: PASS',flush=True)
        finally:App.get_data_dirpath=staticmethod(original)
    except BaseException as error:
        receipt.update(status='failed',error_type=type(error).__name__,error=str(error));traceback.print_exc();raise
    finally:
        receipt['fixture_wall_seconds']=time.perf_counter()-started;save()
if __name__=='__main__':main()
