"""Pinned native CPU static-triangle collider admission, outside the shipping app.

Geometry/run conventions adapted from st-tech/ppf-contact-solver
6b30976/tools/cpu_contact_fixture.py (Claude Code; reviewed Ryoichi Ando), Apache-2.0.
This is a NEW planar static-body experiment, not the unchanged upstream fixture.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
import traceback
from static_metrics import measure,admit

REVISION='6b30976f86e6b94d68d459e5237d59704c7d1384'
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--upstream',type=Path,required=True);parser.add_argument('--out',type=Path,required=True);parser.add_argument('--cache',type=Path,required=True)
args=parser.parse_args();upstream=args.upstream.resolve();out=args.out.resolve();cache=args.cache.resolve();out.mkdir(parents=True,exist_ok=True)
if cache.exists() and any(cache.iterdir()):raise SystemExit('Use an empty dedicated synthetic cache.')
cache.mkdir(parents=True,exist_ok=True)
revision=subprocess.check_output(['git','-C',str(upstream),'rev-parse','HEAD'],text=True).strip()
if revision!=REVISION:raise SystemExit('Refusing unpinned upstream source: '+revision)
receipt={'schema':1,'experiment':'cpu-static-triangle-plane-v1','status':'started','upstream_revision':revision,'backend':'cpu','scope':'One synthetic static plane and falling cloth; not curved bodies, garment/seam admission or physical material validation.','fixture_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'oracle_sha256':hashlib.sha256(Path(__file__).with_name('static_metrics.py').read_bytes()).hexdigest(),'python':platform.python_version(),'machine':platform.machine(),'logical_cpus':os.cpu_count(),'frames_per_case':13,'vertices_per_case':25,'simulated_seconds':.2,'gap_metres':.03,'theoretical_free_fall_metres':.5*9.8*.2**2}
started=time.perf_counter()
def save():(out/'receipt.json').write_text(json.dumps(receipt,indent=2,allow_nan=False)+'\n')
save()
try:
    sys.path.insert(0,str(upstream));os.chdir(upstream)
    import numpy as np
    from frontend import App
    original_data=App.get_data_dirpath
    App.get_data_dirpath=staticmethod(lambda:str(cache/'sessions'))
    def sheet(half,height,twist):
        axis=np.linspace(-half,half,5);c,s=math.cos(twist),math.sin(twist)
        points=np.array([[c*x-s*z,height,s*x+c*z] for x in axis for z in axis],dtype=np.float64)
        faces=[]
        for i in range(4):
            for j in range(4):
                a=i*5+j;b=a+1;d=a+6;faces.extend([[a,a+5,b],[b,a+5,d]])
        return points,np.array(faces,dtype=np.uint32)
    lower_v,lower_f=sheet(.2,1.,0.);lower_f=lower_f[:,[0,2,1]];upper_v,upper_f=sheet(.12,1.03,math.pi/4)
    if not np.all(np.cross(lower_v[lower_f[:,1]]-lower_v[lower_f[:,0]],lower_v[lower_f[:,2]]-lower_v[lower_f[:,0]])[:,1]>0):raise ValueError('Collider plane must face positive Y.')
    parameters={'dt':1/120,'fps':60.,'gravity':[0.,-9.8,0.],'frames':12,'precond':'block-jacobi','young-mod':2000.,'bend':20.,'lower_half_m':.2,'upper_half_m':.12,'lower_y_m':1.,'upper_y_m':1.03,'upper_twist_radians':math.pi/4,'resolution':5,'lower_face_normal':'+Y'}
    (out/'experiment-input.json').write_text(json.dumps({'parameters':parameters,'static_vertices':lower_v.tolist(),'static_triangles':lower_f.tolist(),'upper_vertices':upper_v.tolist(),'upper_triangles':upper_f.tolist(),'admission':{'saved_frames':'exact0..12 per case','coverage':'all upper x/z inside finite plane at every saved frame','held':'zero wrong-side vertex frames at1e-6m tolerance; descent>.25*gap and<.6*freefall','control':'wrong-side vertex frames>0 and descent>.8*freefall','body':'fully pinned lower must be a static mesh outside25 solved upper vertices'}},indent=2)+'\n')
    def triangles(vertices,faces):
        return {tuple(sorted(tuple(round(float(c),6) for c in vertices[int(i)]) for i in face)) for face in faces}
    def run(name,disabled):
        app=App.create('cpu-contact-'+name,cache_dir=str(cache/'meshes'))
        if not Path(app._root).resolve().is_relative_to(cache):raise ValueError('Session escaped the dedicated synthetic root.')
        app.asset.add.tri('lower',lower_v,lower_f);app.asset.add.tri('upper',upper_v,upper_f)
        scene=app.scene.create();lower=scene.add('lower');lower.pin()
        upper=scene.add('upper');upper.param.set('young-mod',2000.).set('bend',20.)
        fixed=scene.build()
        if not lower.static:raise ValueError('Lower mesh was not promoted to a static collider.')
        static_v=fixed._static_vert[1];static_f=fixed._static_tri
        if len(static_v)!=25 or len(static_f)!=32 or triangles(static_v,static_f)!=triangles(lower_v,lower_f):raise ValueError('Actual repacked static triangles differ from the oracle plane.')
        session=app.session.create(fixed)
        session.param.set('dt',1/120).set('fps',60.).set('gravity',[0.,-9.8,0.]).set('precond','block-jacobi').set('frames',12).set('disable-contact',disabled)
        session=session.build();session.start(blocking=True)
        if not session.finished():raise ValueError('Native static-collider run did not complete; inspect retained native logs.')
        output=Path(session.output.path)
        if sorted(p.name for p in output.glob('vert_*.bin'))!=sorted(f'vert_{i}.bin' for i in range(13)):raise ValueError('Missing/extra native output frames.')
        frames=[]
        for i in range(13):
            raw=np.fromfile(output/f'vert_{i}.bin',dtype=np.float32)
            if len(raw)!=75:raise ValueError('Static vertices entered the solved output, or solved vertices are missing.')
            frames.append(raw.reshape(-1,3).tolist())
        rest=np.array(frames[0]);distance=np.linalg.norm(rest[:,None,:]-upper_v[None,:,:],axis=2);rows=np.argmin(distance,axis=0)
        if sorted(rows.tolist())!=list(range(25)) or float(distance[rows,np.arange(25)].max())>1e-6:raise ValueError('Solved rest vertices do not match the authored upper sheet bijectively.')
        result=measure(frames);result.update(static_vertices=25,static_triangles=32,solved_vertices=25,finished=True)
        print(json.dumps({'case':name,'disable_contact':disabled,'result':result}));return result
    try:
        receipt['held']=run('held',False);save()
        receipt['contact_disabled']=run('through',True);save()
        admit(receipt['held'],receipt['contact_disabled'])
        receipt['status']='passed_static_fixture';print('cpu static collider fixture: PASS')
    finally:App.get_data_dirpath=staticmethod(original_data)
except BaseException as error:
    receipt.update(status='failed',error_type=type(error).__name__,error=str(error));traceback.print_exc();raise
finally:
    receipt['fixture_wall_seconds']=time.perf_counter()-started;save()
