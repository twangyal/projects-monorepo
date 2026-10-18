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


INITIALIZED_ARCHIVE_SHA256='392171f0f69ba5b06c1f2312b0695770587bea1beb2f2c86a4e6fa780594e379'
INITIALIZED_SOURCE_SHA256={'garment_native_probe.py':'0353f0532a171616f8e4eed0e69efbb853fd5e2ac24368eb4fdb465e8c863eb4','garment_native_inputs.py':SOURCE_SHA256['garment_native_inputs.py'],'garment_native_export.py':'500910527f5083d80277a0ce8ec3d82e1d20e4932dff714ee20d50e395d951a5','garment_native_initialization.py':'4da3fc8f8af9d876f6cb887e84664e119da3f677a26a3115d324f8281fbc6e36'}

def audit_initialized(path,verify_archive_hash=True):
    from garment_native_initialization import separate_rib,CLOTH_OFFSET_M,BODY_OFFSET_M,RIB_OFFSET_M,CUT_HALF_GAP_M
    data=path.read_bytes() if isinstance(path,Path) else path.read();digest=hashlib.sha256(data).hexdigest()
    if verify_archive_hash:require(digest==INITIALIZED_ARCHIVE_SHA256,'Changed initialized archive.')
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names=z.namelist();require(len(names)==len(set(names)),'Duplicate ZIP members.')
        require(not any(n.startswith('native-cache/') for n in names),'Refusal unexpectedly retains native output.')
        receipt=json.loads(z.read('receipt.json'));supervisor=json.loads(z.read('supervisor.json'))
        original=load_inputs(Path(__file__).with_name('results'));initialized=separate_rib(original)
        require(json.loads(gzip.decompress(z.read('native-blueprint-original.json.gz')))==original,'Changed original control blueprint.')
        require(json.loads(gzip.decompress(z.read('native-blueprint.json.gz')))==initialized,'Changed initialized blueprint.')
        expected={'status':'failed_garment_admission','stage':'initialized_scene_build','current_case':'soft','cases':{},'error_type':'ValidationError','error':'19 self-intersections (19 tri-tri). | 7 element pairs too close.','upstream_revision':REVISION,'source_sha256':INITIALIZED_SOURCE_SHA256,'source_artifact_sha256':original['source_artifact_sha256'],'object_parameters':{**OBJECT,'contact-offset':CLOTH_OFFSET_M},'body_contact_offset_m':BODY_OFFSET_M,'session_parameters':SESSION,'case_normalized_young':CASES,'initialization':'separated','initialization_parameters':{'rib_normal_offset_m':RIB_OFFSET_M,'cut_half_gap_m':CUT_HALF_GAP_M,'combined_cloth_body_offset_m':CLOTH_OFFSET_M+BODY_OFFSET_M},'fixture_step_outcome':'failure','fixture_exit_code':1,'retained_native_files':[]}
        for key,value in expected.items():require(receipt.get(key)==value,'Changed initialized receipt '+key)
        require(supervisor['exit_code']==1 and supervisor['remaining_children']==0 and supervisor['status']=='failed' and supervisor['wall_limit_seconds']==300,'Invalid refusal supervisor.')
        require(z.read('fixture-exit-code.txt').strip()==b'1','Unexpected execution exit.')
        require(z.read('upstream-revision.txt').decode().strip()==REVISION and not z.read('upstream-initial-status.txt').strip(),'Changed/dirty upstream source.')
        require('Exit status: 0' in z.read('build-resources.txt').decode(),'CPU build did not succeed.')
        require(receipt['error'] in z.read('fixture.log').decode(),'Uncorroborated initialized refusal.')
        control=receipt['padding_only_admission'];require(control['status']=='refused_scene_build' and control['error']=='26 self-intersections (26 tri-tri). | 173 element pairs too close.','Changed padding-only outcome.')
        def diagnose(inputs,violations,intersection_count,proximity_count,sample_count):
            def key(tri):return tuple(sorted(tuple(p) for p in tri))
            sources={key([inputs['initial'][i] for i in f]):s['part'] for f,s in zip(inputs['faces'],inputs['face_source'])}
            sources.update({key([inputs['body_vertices'][i] for i in f]):'STATIC-BODY' for f in inputs['body_faces']})
            def part(t):require(key(t) in sources,'Unmapped diagnostic triangle.');return sources[key(t)]
            v={row['type']:row for row in violations};a=v['self_intersection'];b=v['contact_offset']
            require(a['count']==intersection_count and len(a['tris'])==intersection_count,'Incomplete intersection evidence.')
            require(b['count']==proximity_count and len(b['pairs'])==sample_count,'Changed proximity sampling.')
            return {'intersection_parts':dict(Counter('/'.join(sorted(part(t) for t in pair)) for pair in a['tris'])),'reported_proximity_pairs':proximity_count,'sampled_proximity_pairs':sample_count,'proximity_parts':dict(Counter('/'.join(sorted([part(p['ei_pos']),part(p['ej_pos'])])) for p in b['pairs']))}
        return {'archive_sha256':digest,'upstream_revision':REVISION,'source_commit':'5dc38f14141b15d562e74851fc85e33768751572','run_url':'https://github.com/twangyal/projects-monorepo/actions/runs/39115026324','result':'initialized_scene_refused','native_frames':0,'native_files':0,'padding_only':diagnose(original,control['violations'],26,173,100),'initialized':diagnose(initialized,receipt['violations'],19,7,7),'fixture_wall_seconds':receipt['fixture_wall_seconds'],'supervisor_wall_seconds':supervisor['wall_seconds_including_cleanup'],'remaining_children':0,'limitation':'Both control and initialized scenes refused before native export/execution. Reduced counts do not establish valid geometry, material behavior or fit.'}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);parser.add_argument('--initialized',action='store_true');args=parser.parse_args()
    print(json.dumps((audit_initialized if args.initialized else audit)(args.archive),indent=2,allow_nan=False))
