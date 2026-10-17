"""Recompute #282 contact gates from a checksum-pinned original artifact ZIP."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import zipfile
from curved_geometry import sphere,sheet
from curved_metrics import body_planes,measure,admit

def require(condition,message):
    if not condition:raise ValueError(message)

def triangle_set(vertices,faces):
    return {tuple(sorted(tuple(round(c,6) for c in vertices[i]) for i in face)) for face in faces}

def audit(path,expected_sha256):
    raw=Path(path).read_bytes();digest=hashlib.sha256(raw).hexdigest()
    require(digest==expected_sha256,'Archive SHA256 mismatch.')
    with zipfile.ZipFile(path) as z:
        names=z.namelist();require(len(names)==len(set(names)),'Duplicate archive names.')
        receipt=json.loads(z.read('receipt.json'));supervisor=json.loads(z.read('supervisor.json'))
        revision='6b30976f86e6b94d68d459e5237d59704c7d1384'
        require(receipt.get('upstream_revision')==revision and z.read('upstream-revision.txt').decode().strip()==revision,'Wrong upstream revision.')
        for key,name in [('fixture_sha256','curved_probe.py'),('oracle_sha256','curved_metrics.py'),('geometry_sha256','curved_geometry.py')]:
            require(receipt.get(key)==hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest(),'Replay source hash mismatch: '+name)
        require(receipt['status']=='passed_curved_fixture' and receipt['fixture_exit_code']==0 and receipt['fixture_step_outcome']=='success','Native execution did not pass.')
        require(supervisor['exit_code']==0 and supervisor['remaining_children']==0,'Native supervisor did not finish cleanly.')
        manifest=receipt['retained_native_files'];paths={item['path'] for item in manifest}
        require(len(paths)==len(manifest),'Duplicate manifest names.')
        require(paths=={p for p in names if p.startswith('native-cache/') and not p.endswith('/')},'Manifest does not cover every native file.')
        for item in manifest:
            data=z.read(item['path']);require(len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256'],'Native file bytes/hash mismatch: '+item['path'])
        expected_body,body_faces=sphere();upper,authored_faces=sheet();results={}
        for case,key in [('held','held'),('through','contact_disabled')]:
            prefix=f'native-cache/sessions/cpu-contact-{case}/session/'
            expected={prefix+f'output/vert_{i}.bin' for i in range(19)}
            require({p for p in paths if p.startswith(prefix+'output/vert_') and p.endswith('.bin')}==expected,'Missing/extra raw output frames.')
            require(all(prefix+log in paths for log in ['stdout.log','error.log']),'Missing complete native logs.')
            geometry=json.loads(z.read(case+'-geometry.json'));vertices=geometry['static_vertices'];faces=geometry['static_triangles'];rows=geometry['solved_rest_indices']
            require(len(vertices)==114 and len(faces)==224 and triangle_set(vertices,faces)==triangle_set(expected_body,body_faces),'Actual body differs from frozen geometry.')
            require(len(rows)==81 and sorted(rows)==list(range(81)),'Rest mapping is not bijective.')
            def decode(name,code,count):
                file=prefix+'bin/'+name
                require(file in paths,'Missing native scene input: '+name)
                data=z.read(file);size=struct.calcsize('<'+code)
                require(len(data)==count*size,'Wrong native buffer size: '+name)
                values=struct.unpack('<'+str(count)+code,data)
                require(all(math.isfinite(v) for v in values),'Nonfinite native input: '+name)
                return values
            displacement=decode('displacement.bin','d',6)
            require(all(x==0 for x in displacement),'Frozen experiment requires zero object displacements.')
            static_values=decode('static_vert.bin','d',114*3);static_map=decode('static_vert_dmap.bin','I',114)
            dynamic_values=decode('vert.bin','d',81*3);dynamic_map=decode('vert_dmap.bin','I',81)
            require(all(i==0 for i in static_map) and all(i==1 for i in dynamic_map),'Unexpected native object mapping.')
            native_body=[list(static_values[i:i+3]) for i in range(0,114*3,3)]
            static_indices=decode('static_tri.bin','Q',224*3)
            native_faces=[list(static_indices[i:i+3]) for i in range(0,224*3,3)]
            require(native_body==vertices and native_faces==faces,'Native static buffers differ from recorded body.')
            body_planes(native_body,native_faces)
            require(all(max(abs(dynamic_values[rows[i]*3+axis]-upper[i][axis]) for axis in range(3))<=1e-6 for i in range(81)),'Native dynamic input differs from authored rest sheet.')
            indices=decode('tri.bin','Q',128*3)
            native_cloth=[list(indices[i:i+3]) for i in range(0,128*3,3)]
            mapped=[[rows[i] for i in f] for f in authored_faces]
            require({tuple(sorted(f)) for f in native_cloth}=={tuple(sorted(f)) for f in mapped},'Native cloth triangles differ from solved topology.')
            require(mapped==geometry['cloth_triangles'],'Cloth topology differs from authored-to-solved mapping.')
            frames=[]
            for i in range(19):
                data=z.read(prefix+f'output/vert_{i}.bin');require(len(data)==81*3*4,'Wrong native solved namespace.')
                values=struct.unpack('<243f',data);require(all(math.isfinite(c) for c in values),'Nonfinite raw output.')
                frames.append([list(values[j:j+3]) for j in range(0,243,3)])
            require(all(max(abs(frames[0][rows[i]][axis]-upper[i][axis]) for axis in range(3))<=1e-6 for i in range(81)),'Raw rest vertices differ from authored sheet.')
            result=measure(frames,mapped,body_planes(vertices,faces));results[case]=result
            for metric,value in result.items():
                recorded=receipt[key][metric]
                require(value==recorded if value is None else type(recorded) in [int,float] and math.isclose(value,recorded,rel_tol=1e-12,abs_tol=1e-12),'Recomputed metric differs: '+metric)
        admit(results['held'],results['through'])
        return {'archive_sha256':digest,'archive_bytes':len(raw),'native_files_verified':len(manifest),'raw_frames':38,'finite_float32_coordinates':9234,'recomputed':results,'supervisor':supervisor,'source_hashes':{k:receipt.get(k) for k in ['fixture_sha256','oracle_sha256','geometry_sha256']}}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);parser.add_argument('--sha256',required=True);args=parser.parse_args()
    print(json.dumps(audit(args.archive,args.sha256),indent=2,allow_nan=False))
