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
from garment_mass import match_browser_inertia
from garment_warm_start import prepare as prepare_warm_start,load_warm_start
from garment_clearance import outward_preparation,surface_clearance,REQUIRED_CLEARANCE_M
from garment_native_initialization import separate_rib,CLOTH_OFFSET_M,BODY_OFFSET_M,RIB_OFFSET_M,CUT_HALF_GAP_M


def experiment_controls(initialization,unsewn_control=False):
    if unsewn_control and initialization!='warm-sewing':raise ValueError('Unsewn diagnostic requires warm-sewing initialization.')
    controls=dict(OBJECT) if initialization=='strict' else {**OBJECT,'contact-offset':CLOTH_OFFSET_M}
    if unsewn_control:controls['stitch-stiffness']=0.
    return controls

def session_controls(frames,relaxation_study=False,half_step_study=False,gravity_study=None):
    if gravity_study is not None and (gravity_study not in ("reference","zero") or relaxation_study or half_step_study):raise ValueError("Gravity study is a distinct explicit reference or zero protocol.")
    if type(half_step_study) is not bool or (half_step_study and relaxation_study):raise ValueError('Half-step study is a distinct explicit protocol.')
    admitted=[180] if relaxation_study or half_step_study or gravity_study is not None else [18,60]
    if type(frames) is not int or frames not in admitted:raise ValueError('Duration requires an explicitly admitted observation protocol.')
    return {**SESSION,'frames':frames,**({'dt':1/240} if half_step_study else {}),**({'gravity':[0.,0.,0.]} if gravity_study=='zero' else {})}

def case_plan(same_material_control=False):
    return {'first':CASES['soft'],'second':CASES['soft']} if same_material_control else dict(CASES)

def repeatability_settings(initialization,frames,mass_convention,unsewn_control,environment):
    if (initialization,frames,mass_convention,unsewn_control)!=('clear-warm-sewing',60,'browser-inertia',False):raise ValueError('Same-material control requires cleared pose, 60 intervals, captured inertia and normal stitches.')
    return requested_thread_settings(environment)

def relaxation_settings(initialization,frames,mass_convention,unsewn_control,same_material_control,environment):
    if type(frames) is not int or (initialization,frames,mass_convention,unsewn_control,same_material_control)!=('clear-warm-sewing',180,'browser-inertia',False,False):raise ValueError('Relaxation study requires cleared pose, 180 intervals, captured inertia, normal stitches and two materials.')
    return requested_thread_settings(environment)

def fixed_material_cases(name):
    if name not in CASES:raise ValueError('Require one declared soft or stiff material.')
    return {name:CASES[name]}

def fixed_material_settings(initialization,frames,mass_convention,unsewn_control,same_material_control,relaxation_study,environment):
    if relaxation_study:raise ValueError('Fixed-material sessions are a separate protocol from serial pairs.')
    return relaxation_settings(initialization,frames,mass_convention,unsewn_control,same_material_control,environment)

def half_step_settings(initialization,frames,mass_convention,unsewn_control,same_material_control,relaxation_study,fixed_material,environment):
    fixed_material_cases(fixed_material)
    settings=fixed_material_settings(initialization,frames,mass_convention,unsewn_control,same_material_control,relaxation_study,environment)
    if settings['requested_threads']!=4:raise ValueError('Half-step protocol requires requested-four environment.')
    return settings

def gravity_settings(initialization,frames,mass_convention,unsewn_control,same_material_control,relaxation_study,fixed_material,half_step_study,environment):
    if fixed_material!='soft' or half_step_study:raise ValueError('Gravity study requires fixed soft material and original timestep.')
    return half_step_settings(initialization,frames,mass_convention,unsewn_control,same_material_control,relaxation_study,fixed_material,environment)

def preparation_settings(mode,initialization,frames,mass_convention,unsewn_control,same_material_control,relaxation_study,fixed_material,half_step_study,gravity_study,environment):
    if mode not in ('reference','smoothed') or gravity_study is not None:raise ValueError('Preparation study requires a distinct declared reference or smoothed protocol.')
    return gravity_settings(initialization,frames,mass_convention,unsewn_control,same_material_control,relaxation_study,fixed_material,half_step_study,environment)

def requested_thread_settings(environment):
    names=['RAYON_NUM_THREADS','OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS']
    values={name:environment.get(name) for name in names}
    if len(set(values.values()))!=1 or values[names[0]] not in ['1','4']:raise ValueError('Require explicit consistent 1 or 4 requested thread settings.')
    return {'requested_threads':int(values[names[0]]),'variables':values,'scope':'Requested inherited environment, not a measurement of actual native worker counts.'}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ['upstream','out','cache']:parser.add_argument('--'+key,type=Path,required=True)
    parser.add_argument('--initialization',choices=['strict','separated','sewing','warm-sewing','clear-warm-sewing'],default='strict')
    parser.add_argument('--mass-convention',choices=['captured-density','browser-inertia'],default='captured-density')
    parser.add_argument('--unsewn-control',action='store_true',help='Research only: zero stitch forces in warm-sewing; never assembled-garment acceptance.')
    parser.add_argument('--frames',type=int,choices=[18,60,180],default=18)
    parser.add_argument('--same-material-control',action='store_true',help='Research only: two independent Young 500 sessions with fixed preparation and declared thread settings.')
    parser.add_argument('--relaxation-study',action='store_true',help='Research only: explicit three-second two-material observation; no settling acceptance.')
    parser.add_argument('--fixed-material-study',choices=list(CASES),help='Research only: one fixed material in a separate bounded three-second session.')
    parser.add_argument('--half-step-study',action='store_true',help='Research only: explicit fixed-material configured dt=1/240 sensitivity study.')
    parser.add_argument('--gravity-study',choices=['reference','zero'],help='Research only: normal or zero gravity with otherwise fixed soft-material controls.')
    parser.add_argument('--preparation-study',choices=['reference','smoothed'],help='Research only: original or fixed smoothed clearance preparation, with normal gravity and fixed soft material.')
    args=parser.parse_args();upstream=args.upstream.resolve();out=args.out.resolve();cache=args.cache.resolve();out.mkdir(parents=True,exist_ok=True)
    if cache.exists() and any(cache.iterdir()):raise ValueError('Require an empty dedicated synthetic cache.')
    cache.mkdir(parents=True,exist_ok=True)
    revision=subprocess.check_output(['git','-C',str(upstream),'rev-parse','HEAD'],text=True).strip()
    if revision!=REVISION:raise ValueError('Unpinned source.')
    if args.frames>=60 and args.initialization!='clear-warm-sewing':raise ValueError('Longer observation requires the cleared warm pose.')
    session_parameters=session_controls(args.frames,relaxation_study=args.relaxation_study or (args.fixed_material_study is not None and not args.half_step_study and args.gravity_study is None),half_step_study=args.half_step_study,gravity_study=args.gravity_study);frame_count=args.frames+1
    cases=fixed_material_cases(args.fixed_material_study) if args.fixed_material_study is not None else case_plan(args.same_material_control)
    if args.fixed_material_study is not None:execution_settings=fixed_material_settings(args.initialization,args.frames,args.mass_convention,args.unsewn_control,args.same_material_control,args.relaxation_study,os.environ)
    if args.same_material_control:execution_settings=repeatability_settings(args.initialization,args.frames,args.mass_convention,args.unsewn_control,os.environ)
    if args.relaxation_study:execution_settings=relaxation_settings(args.initialization,args.frames,args.mass_convention,args.unsewn_control,args.same_material_control,os.environ)
    if args.half_step_study:execution_settings=half_step_settings(args.initialization,args.frames,args.mass_convention,args.unsewn_control,args.same_material_control,args.relaxation_study,args.fixed_material_study,os.environ)
    if args.gravity_study is not None:execution_settings=gravity_settings(args.initialization,args.frames,args.mass_convention,args.unsewn_control,args.same_material_control,args.relaxation_study,args.fixed_material_study,args.half_step_study,os.environ)
    if args.preparation_study is not None:execution_settings=preparation_settings(args.preparation_study,args.initialization,args.frames,args.mass_convention,args.unsewn_control,args.same_material_control,args.relaxation_study,args.fixed_material_study,args.half_step_study,args.gravity_study,os.environ)
    inputs=load_inputs(Path(__file__).with_name('results'))
    original_inputs=inputs
    controls=experiment_controls(args.initialization,args.unsewn_control)
    body_offset=0. if args.initialization=='strict' else BODY_OFFSET_M
    if args.initialization=='separated':inputs=separate_rib(original_inputs)
    if args.initialization=='sewing':inputs,layout=sewing_layout(original_inputs)
    if args.initialization in ['warm-sewing','clear-warm-sewing']:
        inputs,warm_parameters=prepare_warm_start(original_inputs,load_warm_start(Path(__file__).with_name('results')),Path(__file__).with_name('results'))
        if args.initialization=='clear-warm-sewing':
            body=json.loads(gzip.decompress(Path(__file__).with_name('results').joinpath('garment-first.json.gz').read_bytes()))['packet']['body']
            if args.preparation_study is not None:
                from garment_preparation import outward
                inputs,clear_parameters=outward(inputs,body,args.preparation_study)
            else:inputs,clear_parameters=outward_preparation(inputs,body)
        inputs,layout=sewing_layout(inputs)
        if args.initialization=='clear-warm-sewing':
            clear_parameters['surface_admission']=surface_clearance(inputs,REQUIRED_CLEARANCE_M)
            if clear_parameters['surface_admission']['violations']:raise ValueError('Prepared cloth/body surface is not barrier-clear.')
    if args.mass_convention=='browser-inertia':inputs,mass_mapping=match_browser_inertia(original_inputs,inputs,Path(__file__).with_name('results'))
    receipt={'schema':1,'experiment':'actual-garment-native-'+args.initialization+'-v1','status':'started','stage':'prepared','upstream_revision':revision,'frames_per_case':frame_count,'case_names':list(cases),'case_session_prefix':'cpu-garment-','cases':{},'source_sha256':{name:hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest() for name in ['garment_native_probe.py','garment_native_inputs.py','garment_native_export.py','garment_native_initialization.py','garment_sewing_layout.py','garment_mass.py','garment_warm_start.py','garment_clearance.py','garment_admission.py']},'source_artifact_sha256':inputs['source_artifact_sha256'],'object_parameters':controls,'body_contact_offset_m':body_offset,'initialization':args.initialization,'session_parameters':session_parameters,'case_normalized_young':cases,'scope':'Declared initialization experiment; no intersection allowances/contact disabling, no physical-material or settling acceptance.'}
    if args.preparation_study is not None:
        receipt['source_sha256']['garment_preparation.py']=hashlib.sha256(Path(__file__).with_name('garment_preparation.py').read_bytes()).hexdigest()
    if args.fixed_material_study is not None:
        receipt.update(experiment=receipt['experiment']+'-fixed-material-study',fixed_material_study=args.fixed_material_study,execution_settings=execution_settings,scope='Separate bounded three-second fixed-material session; not completion of the original serial pair, sustained settling, calibrated fabric, physical fit or backend adoption acceptance.')
    if args.preparation_study is not None:
        receipt.update(experiment=receipt['experiment']+'-preparation-study',preparation_study=args.preparation_study,scope='Declared startup-geometry control with original rest, captured inertia, body, contact and stitches; not settling, calibrated fabric or fit acceptance.')
    if args.half_step_study:
        receipt.update(experiment=receipt['experiment']+'-half-step-study',half_step_study=True,scope='Configured dt1/240 fixed-material sensitivity only; not timestep/mesh convergence, stress, physical fit or backend adoption acceptance.')
    if args.gravity_study is not None:
        receipt.update(experiment=receipt['experiment']+'-gravity-study',gravity_study=args.gravity_study,scope='Gravity-only diagnostic with original rest geometry, mass, body contact and stitches; not construction causality, physical fit or backend adoption acceptance.')
    if args.relaxation_study:
        receipt.update(experiment=receipt['experiment']+'-relaxation-study',relaxation_study=True,execution_settings=execution_settings,scope='Bounded three-second two-material observation; not sustained settling, calibrated fabric, physical fit or backend adoption acceptance.')
    if args.same_material_control:
        receipt.update(experiment=receipt['experiment']+'-same-material-control',same_material_control=True,execution_settings=execution_settings,scope='Same-material repeated native motion only; not material discrimination, settling or physical fit acceptance.')
    if args.unsewn_control:
        receipt.update(experiment=receipt['experiment']+'-unsewn-control',unsewn_control=True,scope='Zero stitch-force diagnostic only. Same strict contacts and rest/mass/body/seam data; not assembled garment, material, settling or physical-fit acceptance.')
    started=time.perf_counter()
    def save():(out/'receipt.json').write_text(json.dumps(receipt,indent=2,allow_nan=False)+'\n')
    if args.initialization=='separated':receipt['initialization_parameters']={'rib_normal_offset_m':RIB_OFFSET_M,'cut_half_gap_m':CUT_HALF_GAP_M,'combined_cloth_body_offset_m':CLOTH_OFFSET_M+BODY_OFFSET_M}
    if args.initialization in ['sewing','warm-sewing','clear-warm-sewing']:receipt['initialization_parameters']=layout
    if args.initialization in ['warm-sewing','clear-warm-sewing']:receipt['warm_start_parameters']=warm_parameters
    if args.initialization=='clear-warm-sewing':receipt['clearance_preparation']=clear_parameters
    receipt['mass_convention']=args.mass_convention
    if args.mass_convention=='browser-inertia':receipt['mass_parameters']=mass_mapping
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
            for name,young in cases.items():
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
                for key,value in session_parameters.items():session.param.set(key,value)
                receipt['stage']='native_session_build';save();session=session.build()
                receipt['stage']='native_export_admission';save()
                directory=Path(session.info.path)
                receipt.setdefault('native_input_admission',{})[name]=verify_export(lambda path:(directory/path).read_bytes(),inputs,young,object_parameters=controls,body_contact_offset=body_offset,session_parameters=session_parameters,half_step_study=args.half_step_study,gravity_study=args.gravity_study)
                save()
                receipt['stage']='native_execution';save();case_start=time.perf_counter();session.start(blocking=True)
                if not session.finished():raise ValueError('Native process did not finish.')
                output=Path(session.output.path)
                if {p.name for p in output.glob('vert_*.bin')}!={f'vert_{i}.bin' for i in range(frame_count)}:raise ValueError('Incomplete actual frame set.')
                frames=[]
                for i in range(frame_count):
                    values=np.fromfile(output/f'vert_{i}.bin',dtype=np.float32)
                    if len(values)!=2353*3 or not np.isfinite(values).all():raise ValueError('Invalid solved vertex namespace/values.')
                    frames.append(values.reshape(-1,3))
                movement=max(float(np.linalg.norm(frame-frames[0],axis=1).max()) for frame in frames[1:])
                if movement<=1e-6:raise ValueError('Frozen/nonmoving output is not an execution result.')
                receipt['cases'][name]={'frames':frame_count,'vertices':2353,'maximum_displacement_m':movement,'native_wall_seconds':time.perf_counter()-case_start};save()
            receipt.update(status='passed_unsewn_diagnostic_motion' if args.unsewn_control else 'passed_garment_motion_probe',stage='completed');save();print('cpu unsewn diagnostic motion: PASS' if args.unsewn_control else 'cpu actual garment motion probe: PASS',flush=True)
        finally:App.get_data_dirpath=staticmethod(original)
    except BaseException as error:
        receipt.update(status='failed_garment_admission',error_type=type(error).__name__,error=str(error))
        if hasattr(error,'violations'):receipt['violations']=json.loads(json.dumps(error.violations,default=lambda value:value.tolist() if hasattr(value,'tolist') else str(value)))
        save();traceback.print_exc();raise
    finally:receipt['fixture_wall_seconds']=time.perf_counter()-started;save()
if __name__=='__main__':main()
