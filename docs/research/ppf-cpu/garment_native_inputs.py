"""Frozen real-garment native ABI preparation, independent of NumPy/frontend."""
import gzip
import hashlib
import json
from garment_admission import require

HASHES={'garment-first.json.gz':'9d42e001549f4dc8b4558b14b33a58404c02204a22a93b2c16fda31db17fc045','garment-rest-candidate.json.gz':'65b7803437d3c6cdddd81fe23118b222a2bd2ee5b6f3b428e5d50093ae14041e','garment-body-candidate.json.gz':'bd9ea2954855b0ba2db985c27feb0079af6eaac73806a581046ee0831e431965'}
REVISION='6b30976f86e6b94d68d459e5237d59704c7d1384'
CASES={'soft':500.,'stiff':2000.}
OBJECT={'model':'baraff-witkin','poiss-rat':.3,'bend':20.,'strain-limit':0.,'deformation-damping':.02,'contact-gap':.001,'contact-offset':.0035,'stitch-stiffness':1.}
SESSION={'dt':1/120,'fps':60.,'gravity':[0.,-9.8,0.],'frames':18,'precond':'block-jacobi','air-density':0.,'disable-contact':False}


def shell_map(count,faces):
    require(type(count) is int and count>0,'Invalid count.')
    mapping=[-1]*count;cursor=0
    for face in faces:
        require(len(face)==3 and len(set(face))==3,'Degenerate face.')
        for i in face:
            require(type(i) is int and 0<=i<count,'Invalid face index.')
            if mapping[i]<0:mapping[i]=cursor;cursor+=1
    for i in range(count):
        if mapping[i]<0:mapping[i]=cursor;cursor+=1
    return mapping


def encode_stitches(pairs,mapping):
    indices=[];weights=[]
    require(sorted(mapping)==list(range(len(mapping))),'Nonbijective map.')
    for a,b in pairs:
        require(type(a) is int and type(b) is int and a!=b and min(a,b)>=0 and max(a,b)<len(mapping),'Invalid sew pair.')
        indices.append([mapping[a]]*3+[mapping[b]]*3);weights.append([1.,0.,0.,1.,0.,0.])
    return indices,weights


def load_inputs(root):
    decoded={}
    for name,digest in HASHES.items():
        raw=(root/name).read_bytes();require(hashlib.sha256(raw).hexdigest()==digest,'Changed frozen source artifact: '+name)
        decoded[name]=json.loads(gzip.decompress(raw))
    envelope=decoded['garment-first.json.gz'];candidate=decoded['garment-rest-candidate.json.gz'];body=decoded['garment-body-candidate.json.gz']
    faces=[f['vertices'] for f in candidate['faces']];mapping=shell_map(len(candidate['initial_positions_m']),faces)
    def scatter(values):
        result=[None]*len(mapping)
        for authored,solved in enumerate(mapping):result[solved]=values[authored]
        return result
    stitch_indices,stitch_weights=encode_stitches(candidate['sew_pairs'],mapping)
    density={p['part']:p['areal_density_kg_m2'] for p in envelope['packet']['parts']}
    return {'authored_to_solved':mapping,'initial':scatter(candidate['initial_positions_m']),'rest':scatter(candidate['rest_positions_m']),'faces':[[mapping[v] for v in f] for f in faces],'uv':[f['authored_uv_m'] for f in candidate['faces']],'face_density':[density[f['part']] for f in candidate['faces']],'face_source':[{'part':f['part'],'render_triangle':f['render_triangle']} for f in candidate['faces']],'stitch_indices':stitch_indices,'stitch_weights':stitch_weights,'body_vertices':body['vertices_m'],'body_faces':body['triangles'],'source_artifact_sha256':HASHES}
