"""Checksum-pinned raw native input/output replay for the #285 tensile experiment.

Never unpickles artifacts. No upstream/native solver is needed for this audit.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import tomllib
import zipfile
from tensile_metrics import strip,measure,admit,CASES,PARAMETERS,SESSION
REVISION='6b30976f86e6b94d68d459e5237d59704c7d1384'

def require(value,message):
    if not value:raise ValueError(message)

def verify_manifest(z,receipt):
    names=z.namelist();require(len(names)==len(set(names)),'Duplicate ZIP names.')
    manifest=receipt['retained_native_files'];paths={m['path'] for m in manifest}
    require(len(paths)==len(manifest),'Duplicate manifest names.')
    require(paths=={n for n in names if n.startswith('native-cache/') and not n.endswith('/')},'Incomplete native manifest.')
    for item in manifest:
        data=z.read(item['path']);require(len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256'],'Native hash/size mismatch: '+item['path'])
    return paths

def native_case(z,paths,name):
    prefix=f'native-cache/sessions/cpu-tensile-{name}/session/'
    def decode(file,code,count):
        path=prefix+'bin/'+file;require(path in paths,'Missing native input: '+file)
        data=z.read(path);require(len(data)==struct.calcsize('<'+code)*count,'Wrong native input size: '+file)
        values=struct.unpack('<'+str(count)+code,data)
        require(all(math.isfinite(v) for v in values),'Nonfinite native input: '+file)
        return values
    info=tomllib.loads(z.read(prefix+'info.toml').decode());counts=info['count']
    pin=info['pin-0']
    require(set(pin)=={'operation_count','pin','pull','pin_group_id'} and pin['operation_count']==0 and pin['pin']==4 and pin['pull']==0. and str(pin['pin_group_id']).startswith('strip:pin_'),'Unexpected pin settings.')
    require(not any(k.startswith('pin-') and k!='pin-0' for k in info),'Unexpected pin operation/group.')
    require(prefix+'bin/pin-pullw-0.bin' not in paths,'Unexpected pin pull override.')
    for key,value in {'vert':84,'tri':120,'static_vert':0,'static_tri':0,'pin_block':1,'rod':0,'tet':0,'wall':0,'sphere':0,'stitch':0,'display_pin_block':0,'rod_vert_start':0,'rod_vert_end':0,'shell_vert_start':0,'rod_count':0,'has_rest_vert':False,'has_rest_vert_anim':False,'rest_vert_anim_frames':0,'has_bend_rest_vert':False,'shell_vert_end':84,'shell_count':120}.items():require(counts[key]==value,'Unexpected native scene count: '+key)
    geometry=json.loads(z.read(name+'-geometry.json'));rows=geometry['authored_to_solved']
    require(len(rows)==84 and all(type(i) is int for i in rows) and sorted(rows)==list(range(84)),'Nonbijective rest map.')
    require(sorted(decode('pin-ind-0.bin','Q',4))==sorted(rows[80:84]),'Wrong native pin membership.')
    vertices,faces=strip();native=decode('vert.bin','d',252)
    require(all(abs(native[rows[i]*3+j]-vertices[i][j])<=1e-9 for i in range(84) for j in range(3)),'Native rest differs from frozen strip.')
    require(all(x==0 for x in decode('uv.bin','f',720)),'Unexpected authored material UV.')
    require(all(x==0 for x in decode('vel.bin','f',252)),'Unexpected initial velocity.')
    require(all(x==0 for x in decode('displacement.bin','d',3)),'Unexpected displacement.')
    require(all(x==0 for x in decode('vert_dmap.bin','I',84)),'Unexpected object map.')
    indices=decode('tri.bin','Q',360);actual=[tuple(indices[i:i+3]) for i in range(0,360,3)]
    expected=[tuple(rows[i] for i in f) for f in faces]
    require(sorted(actual)==sorted(expected),'Native topology differs from frozen strip.')
    for key,value in {**PARAMETERS,**CASES[name],'shrink-x':1.,'shrink-y':1.,'bend-warp':0.,'bend-weft':0.,'bending-damping':0.,'pressure':0.,'plasticity':0.,'bend-plasticity':0.}.items():
        if key=='model':require(set(decode('param/tri-model.bin','B',120))=={2},'Unexpected native model.')
        else:require(all(math.isclose(v,value,rel_tol=1e-6,abs_tol=1e-9) for v in decode('param/tri-'+key+'.bin','f',120)),'Unexpected material parameter: '+key)
    parameters=tomllib.loads(z.read(prefix+'param.toml').decode())['param']
    for key,value in SESSION.items():require(parameters[key.replace('-','_')]==value,'Unexpected session parameter: '+key)
    require(all(prefix+log in paths for log in ['stdout.log','error.log']),'Missing native logs.')
    expected_frames={prefix+f'output/vert_{i}.bin' for i in range(151)}
    require({p for p in paths if p.startswith(prefix+'output/vert_') and p.endswith('.bin')}==expected_frames,'Missing/extra native frames.')
    frames=[]
    for i in range(151):
        raw=z.read(prefix+f'output/vert_{i}.bin');require(len(raw)==1008,'Wrong native frame size.')
        values=struct.unpack('<252f',raw);frames.append([list(values[j*3:j*3+3]) for j in rows])
    return measure(frames,vertices),frames

def audit(path,sha256):
    raw=Path(path).read_bytes();digest=hashlib.sha256(raw).hexdigest();require(digest==sha256,'Archive SHA256 mismatch.')
    with zipfile.ZipFile(path) as z:
        receipt=json.loads(z.read('receipt.json'));paths=verify_manifest(z,receipt)
        require(receipt['upstream_revision']==REVISION and z.read('upstream-revision.txt').decode().strip()==REVISION,'Wrong upstream revision.')
        for name in ['tensile_probe.py','tensile_metrics.py']:
            require(receipt['source_sha256'][name]==hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest(),'Replay source hash mismatch: '+name)
        require(receipt['status']=='passed_tensile_fixture' and receipt['fixture_exit_code']==0 and receipt['fixture_step_outcome']=='success','Native execution/admission did not pass.')
        supervisor=json.loads(z.read('supervisor.json'));require(supervisor['exit_code']==0 and supervisor['remaining_children']==0,'Supervisor did not finish cleanly.')
        results={};frames={}
        for name in CASES:results[name],frames[name]=native_case(z,paths,name)
        results['density']['density_max_difference_m']=max(math.dist(a,b) for x,y in zip(frames['soft'],frames['density']) for a,b in zip(x,y))
        for name,result in results.items():
            for key,value in result.items():require(math.isclose(value,receipt['cases'][name][key],rel_tol=1e-12,abs_tol=1e-12),'Receipt differs from raw-frame metric: '+name+'/'+key)
        admit(results)
        return {'archive_sha256':digest,'archive_bytes':len(raw),'native_files_verified':len(paths),'raw_frames':453,'finite_float32_coordinates':453*252,'recomputed':results,'supervisor':supervisor}
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);parser.add_argument('--sha256',required=True);args=parser.parse_args();print(json.dumps(audit(args.archive,args.sha256),indent=2,allow_nan=False))
