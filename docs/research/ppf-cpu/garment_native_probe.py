"""Actual frozen garment admission and bounded CPU motion; not calibrated fit."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import traceback
from garment_native_inputs import load_inputs,REVISION,CASES,OBJECT,SESSION
from garment_native_export import verify_export


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ['upstream','out','cache']:parser.add_argument('--'+key,type=Path,required=True)
    args=parser.parse_args();upstream=args.upstream.resolve();out=args.out.resolve();cache=args.cache.resolve();out.mkdir(parents=True,exist_ok=True)
    if cache.exists() and any(cache.iterdir()):raise ValueError('Require an empty dedicated synthetic cache.')
    cache.mkdir(parents=True,exist_ok=True)
    revision=subprocess.check_output(['git','-C',str(upstream),'rev-parse','HEAD'],text=True).strip()
    if revision!=REVISION:raise ValueError('Unpinned source.')
    inputs=load_inputs(Path(__file__).with_name('results'))
    receipt={'schema':1,'experiment':'actual-garment-native-strict-v1','status':'started','stage':'prepared','upstream_revision':revision,'frames_per_case':19,'case_names':list(CASES),'case_session_prefix':'cpu-garment-','cases':{},'source_sha256':{name:hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest() for name in ['garment_native_probe.py','garment_native_inputs.py','garment_native_export.py']},'source_artifact_sha256':inputs['source_artifact_sha256'],'object_parameters':OBJECT,'session_parameters':SESSION,'case_normalized_young':CASES,'scope':'Strict unchanged original pose; no intersection allowances/contact disabling, no physical-material or settling acceptance.'}
    started=time.perf_counter()
    def save():(out/'receipt.json').write_text(json.dumps(receipt,indent=2,allow_nan=False)+'\n')
    save()
    (out/'native-blueprint.json.gz').write_bytes(gzip.compress((json.dumps(inputs,separators=(',',':'))+'\n').encode(),mtime=0))
    try:
        sys.path.insert(0,str(upstream));os.chdir(upstream)
        import numpy as np
        from frontend import App
        original=App.get_data_dirpath;App.get_data_dirpath=staticmethod(lambda:str(cache/'sessions'))
        try:
            for name,young in CASES.items():
                receipt.update(stage='asset_upload',current_case=name);save()
                app=App.create('cpu-garment-'+name,cache_dir=str(cache/'meshes'))
                if not Path(app._root).resolve().is_relative_to(cache):raise ValueError('Session escaped synthetic cache.')
                app.asset.add.tri('tee',np.array(inputs['initial'],dtype=np.float64),np.array(inputs['faces'],dtype=np.uint32))
                app.asset.add.tri('body',np.array(inputs['body_vertices'],dtype=np.float64),np.array(inputs['body_faces'],dtype=np.uint32))
                app.asset.add.stitch('seams',(np.array(inputs['stitch_indices'],dtype=np.uint32),np.array(inputs['stitch_weights'],dtype=np.float32)))
                scene=app.scene.create();cloth=scene.add('tee').stitch('seams');body=scene.add('body');body.pin()
                for key,value in {**OBJECT,'young-mod':young}.items():cloth.param.set(key,value)
                cloth.set_uv([np.array(face,dtype=np.float32) for face in inputs['uv']])
                receipt['stage']='strict_scene_build';save()
                fixed=scene.build()
                if not body.static:raise ValueError('Body did not become a genuine static collider.')
                if not np.array_equal(fixed.vertex(True),np.array(inputs['initial'])) or not np.array_equal(fixed._tri,np.array(inputs['faces'])):raise ValueError('Native first-visit repacking differs from the declared exact map.')
                if not np.array_equal(fixed._stitch_ind,np.array(inputs['stitch_indices'])) or not np.array_equal(fixed._stitch_w,np.array(inputs['stitch_weights'])):raise ValueError('Native stitch ABI drift.')
                # Pinned private ABI: alternate rest positions, not appearance UVs,
                # supply the original intrinsic metric. Raw exported bytes are verified before execution.
                fixed._concat_rest_vert=np.array(inputs['rest'],dtype=np.float64)
                fixed._rest_vert_mask=np.ones(len(inputs['rest']),dtype=np.uint8)
                fixed._tri_param['density']=inputs['face_density'][:]
                session=app.session.create(fixed)
                for key,value in SESSION.items():session.param.set(key,value)
                receipt['stage']='native_session_build';save();session=session.build()
                receipt['stage']='native_export_admission';save()
                directory=Path(session.info.path)
                receipt.setdefault('native_input_admission',{})[name]=verify_export(lambda path:(directory/path).read_bytes(),inputs,young)
                save()
                receipt['stage']='native_execution';save();case_start=time.perf_counter();session.start(blocking=True)
                if not session.finished():raise ValueError('Native process did not finish.')
                output=Path(session.output.path)
                if {p.name for p in output.glob('vert_*.bin')}!={f'vert_{i}.bin' for i in range(19)}:raise ValueError('Incomplete actual frame set.')
                frames=[]
                for i in range(19):
                    values=np.fromfile(output/f'vert_{i}.bin',dtype=np.float32)
                    if len(values)!=2353*3 or not np.isfinite(values).all():raise ValueError('Invalid solved vertex namespace/values.')
                    frames.append(values.reshape(-1,3))
                movement=max(float(np.linalg.norm(frame-frames[0],axis=1).max()) for frame in frames[1:])
                if movement<=1e-6:raise ValueError('Frozen/nonmoving output is not an execution result.')
                receipt['cases'][name]={'frames':19,'vertices':2353,'maximum_displacement_m':movement,'native_wall_seconds':time.perf_counter()-case_start};save()
            receipt.update(status='passed_garment_motion_probe',stage='completed');save();print('cpu actual garment motion probe: PASS',flush=True)
        finally:App.get_data_dirpath=staticmethod(original)
    except BaseException as error:
        receipt.update(status='failed_garment_admission',error_type=type(error).__name__,error=str(error))
        if hasattr(error,'violations'):receipt['violations']=json.loads(json.dumps(error.violations,default=lambda value:value.tolist() if hasattr(value,'tolist') else str(value)))
        save();traceback.print_exc();raise
    finally:receipt['fixture_wall_seconds']=time.perf_counter()-started;save()
if __name__=='__main__':main()
