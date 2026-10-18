"""Replay the retained first native refusal without importing native code or pickle."""
import argparse
from collections import Counter
import gzip
import hashlib
import io
import json
from pathlib import Path
import zipfile
from garment_admission import require
from garment_native_inputs import load_inputs,REVISION,OBJECT,SESSION,CASES

ARCHIVE_SHA256='582e4b7593d608f90fb238f631e2492f548cbd3d85b698a03ce537397ffb5a15'
SOURCE_SHA256={'garment_native_probe.py':'4be01a991889ebfb9b213b47748252a2278b23c2f280e7d6b333ea9198d72ab3','garment_native_inputs.py':'7fabcff5d5a36e5ab296d20f7078a1c686ed5ec1e9ae2deaf13406134c3d56d6'}

def audit(path,verify_archive_hash=True):
    data=path.read_bytes() if isinstance(path,Path) else path.read()
    digest=hashlib.sha256(data).hexdigest()
    if verify_archive_hash:require(digest==ARCHIVE_SHA256,'Changed retained strict archive.')
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names=z.namelist();require(len(names)==len(set(names)),'Duplicate ZIP members.')
        require(not any(n.startswith('native-cache/') for n in names),'Refusal unexpectedly retains native output.')
        receipt=json.loads(z.read('receipt.json'));supervisor=json.loads(z.read('supervisor.json'))
        inputs=load_inputs(Path(__file__).with_name('results'))
        require(json.loads(gzip.decompress(z.read('native-blueprint.json.gz')))==inputs,'Changed original blueprint.')
        for key,value in {'status':'failed_garment_admission','stage':'strict_scene_build','current_case':'soft','cases':{},'error_type':'ValidationError','error':'26 self-intersections (26 tri-tri). | 265 element pairs too close.','upstream_revision':REVISION,'source_sha256':SOURCE_SHA256,'source_artifact_sha256':inputs['source_artifact_sha256'],'object_parameters':OBJECT,'session_parameters':SESSION,'case_normalized_young':CASES}.items():
            require(receipt.get(key)==value,'Changed strict receipt '+key)
        require(supervisor['exit_code']==1 and supervisor['remaining_children']==0 and supervisor['status']=='failed' and supervisor['wall_limit_seconds']==300,'Invalid refusal supervisor.')
        require(z.read('fixture-exit-code.txt').strip()==b'1','Unexpected execution exit.')
        require(z.read('upstream-revision.txt').decode().strip()==REVISION,'Changed upstream source.')
        require(not z.read('upstream-initial-status.txt').strip(),'Dirty upstream build.')
        require('Exit status: 0' in z.read('build-resources.txt').decode(),'CPU build did not succeed.')
        require(receipt['error'] in z.read('fixture.log').decode(),'Uncorroborated native refusal.')
        def key(tri):return tuple(sorted(tuple(p) for p in tri))
        sources={key([inputs['initial'][i] for i in f]):s['part'] for f,s in zip(inputs['faces'],inputs['face_source'])}
        sources.update({key([inputs['body_vertices'][i] for i in f]):'STATIC-BODY' for f in inputs['body_faces']})
        def part(tri):
            require(key(tri) in sources,'Unmapped diagnostic triangle.')
            return sources[key(tri)]
        violations={v['type']:v for v in receipt['violations']}
        intersections=violations['self_intersection'];proximity=violations['contact_offset']
        require(intersections['count']==26 and len(intersections['tris'])==26,'Incomplete intersection report.')
        require(proximity['count']==265 and len(proximity['pairs'])==100,'Changed sampled proximity report.')
        intersection_parts=Counter('/'.join(sorted(part(t) for t in pair)) for pair in intersections['tris'])
        proximity_parts=Counter('/'.join(sorted([part(p['ei_pos']),part(p['ej_pos'])])) for p in proximity['pairs'])
        return {'archive_sha256':digest,'upstream_revision':REVISION,'source_commit':'a9837ad7b46f517a9738cc021dde4b2dfe5f5366','run_url':'https://github.com/twangyal/projects-monorepo/actions/runs/39114026348','result':'strict_scene_refused','native_frames':0,'native_files':0,'intersection_parts':dict(intersection_parts),'reported_proximity_pairs':265,'sampled_proximity_pairs':100,'sampled_proximity_parts':dict(proximity_parts),'fixture_wall_seconds':receipt['fixture_wall_seconds'],'supervisor_wall_seconds':supervisor['wall_seconds_including_cleanup'],'remaining_children':0,'limitation':'Frontend refusal, not native solver motion, settling, calibrated material or fit acceptance.'}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);args=parser.parse_args()
    print(json.dumps(audit(args.archive),indent=2,allow_nan=False))
