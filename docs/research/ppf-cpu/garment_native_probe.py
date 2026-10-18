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
from garment_sewing_layout import sewing_layout
from garment_native_initialization import separate_rib,CLOTH_OFFSET_M,BODY_OFFSET_M,RIB_OFFSET_M,CUT_HALF_GAP_M


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ['upstream','out','cache']:parser.add_argument('--'+key,type=Path,required=True)
    parser.add_argument('--initialization',choices=['strict','separated','sewing'],default='strict')
    args=parser.parse_args();upstream=args.upstream.resolve();out=args.out.resolve();cache=args.cache.resolve();out.mkdir(parents=True,exist_ok=True)
    if cache.exists() and any(cache.iterdir()):raise ValueError('Require an empty dedicated synthetic cache.')
    cache.mkdir(parents=True,exist_ok=True)
    revision=subprocess.check_output(['git','-C',str(upstream),'rev-parse','HEAD'],text=True).strip()
    if revision!=REVISION:raise ValueError('Unpinned source.')
    inputs=load_inputs(Path(__file__).with_name('results'))
    original_inputs=inputs
    controls=OBJECT if args.initialization=='strict' else {**OBJECT,'contact-offset':CLOTH_OFFSET_M}
    body_offset=0. if args.initialization=='strict' else BODY_OFFSET_M
    if args.initialization=='separated':inputs=separate_rib(original_inputs)
    if args.initialization=='sewing':inputs,layout=sewing_layout(original_inputs)
    receipt={'schema':1,'experiment':'actual-garment-native-'+args.initialization+'-v1','status':'started','stage':'prepared','upstream_revision':revision,'frames_per_case':19,'case_names':list(CASES),'case_session_prefix':'cpu-garment-','cases':{},'source_sha256':{name:hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest() for name in ['garment_native_probe.py','garment_native_inputs.py','garment_native_export.py','garment_native_initialization.py','garment_sewing_layout.py']},'source_artifact_sha256':inputs['source_artifact_sha256'],'object_parameters':controls,'body_contact_offset_m':body_offset,'initialization':args.initialization,'session_parameters':SESSION,'case_normalized_young':CASES,'scope':'Declared initialization experiment; no intersection allowances/contact disabling, no physical-material or settling acceptance.'}
    started=time.perf_counter()
    def save():(out/'receipt.json').write_text(json.dumps(receipt,indent=2,allow_nan=False)+'\n')
    if args.initialization=='separated':receipt['initialization_parameters']={'rib_normal_offset_m':RIB_OFFSET_M,'cut_half_gap_m':CUT_HALF_GAP_M,'combined_cloth_body_offset_m':CLOTH_OFFSET_M+BODY_OFFSET_M}
    if args.initialization=='sewing':receipt['initialization_parameters']=layout
    save()
    (out/'native-blueprint-original.json.gz').write_bytes(gzip.compress((json.dumps(original_inputs,separators=(',',':'))+'\n').encode(),mtime=0))
    (out/'native-blueprint.json.gz').write_bytes(gzip.compress((json.dumps(inputs,separators=(',',':'))+'\n').encode(),mtime=0))
    try:
        sys.path.insert(0,str(upstream));os.chdir(upstream)
        import numpy as np
        from frontend import App
        original=App.get_data_dirpath;App.get_data_dirpath=staticmethod(lambda:str(cache/'sessions'))
        try:
            def build_scene(name,prepared,young):
                app=App.create('cpu-garment-'+name,cache_dir=str(cache/'meshes'))
                if not Path(app._root).resolve().is_relative_to(cache):raise ValueError('Session escaped synthetic cache.')
                app.asset.add.tri('tee',np.array(prepared['initial'],dtype=np.float64),np.array(prepared['faces'],dtype=np.uint32))
                app.asset.add.tri('body',np.array(prepared['body_vertices'],dtype=np.float64),np.array(prepared['body_faces'],dtype=np.uint32))
                app.asset.add.stitch('seams',(np.array(prepared['stitch_indices'],dtype=np.uint32),np.array(prepared['stitch_weights'],dtype=np.float32)))
                scene=app.scene.create();cloth=scene.add('tee').stitch('seams');body=scene.add('body');body.pin();body.param.set('contact-offset',body_offset)
                for key,value in {**controls,'young-mod':young}.items():cloth.param.set(key,value)
                cloth.set_uv([np.array(face,dtype=np.float32) for face in prepared['uv']])
                return app,body,scene.build()
            if args.initialization=='separated':
                from frontend._scene_ import ValidationError
                receipt['stage']='padding_only_scene_build';save()
                try:
                    build_scene('padding',original_inputs,CASES['soft'])
                    receipt['padding_only_admission']={'status':'passed_scene_build'}
                except ValidationError as error:
                    receipt['padding_only_admission']={'status':'refused_scene_build','error':str(error),'violations':json.loads(json.dumps(error.violations,default=lambda v:v.tolist() if hasattr(v,'tolist') else str(v)))}
                save()
            for name,young in CASES.items():
                receipt.update(stage='strict_scene_build' if args.initialization=='strict' else 'initialized_scene_build',current_case=name);save()
                app,body,fixed=build_scene(name,inputs,young)
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
                receipt.setdefault('native_input_admission',{})[name]=verify_export(lambda path:(directory/path).read_bytes(),inputs,young,object_parameters=controls,body_contact_offset=body_offset)
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
