"""Candidate cut-rib intrinsic-rest mapping, not a runnable/admitted native scene.

Only membrane edge/rest and initial-pose identity are admitted here. Sewing pairs
are semantic zero-distance joins, NOT upstream's barycentric-stitch ABI and NOT
an assertion that its penalty/contact/bending behavior equals browser welds.
"""
import argparse
import copy
import gzip
import hashlib
import json
import math
from pathlib import Path
from garment_admission import audit,require


def build_mapping(envelope):
    audit(envelope)
    p=envelope['packet'];positions=p['positions_m']
    points=[positions[i:i+3] for i in range(0,len(positions),3)]
    edges={tuple(sorted(c['particles'])):c['rest_m'] for c in p['constraints'] if c['kind']=='structural'}
    initial=[];rest=[];source_particles=[];main={};local_maps={}
    def vertex(source,reference):
        result=len(initial);initial.append(points[source][:]);rest.append(reference[:]);source_particles.append(source)
        return result
    # Main panels already use a shared flatXY metric. Their side/shoulder/armhole
    # welds stay welded; front/back overlap in reference space only, not initially.
    for part in p['parts'][:-1]:
        ids=[]
        for source in part['particles']:
            if source not in main:main[source]=vertex(source,[points[source][0],points[source][1],0.])
            ids.append(main[source])
        local_maps[part['part']]=ids
    # The original rib is a periodic strip with repeated shoulder rows. Remove
    # only consecutive duplicate rows; retain a distinct duplicate of the first
    # row at the end as the explicit cut/closing seam.
    rib=p['parts'][-1];ids=rib['particles'];mapping=[];sew=[];along=0.;previous=None;first_outer=None
    for row in range(len(ids)//2):
        pair=ids[row*2:row*2+2]
        if pair==previous:
            mapping.extend(mapping[-2:]);continue
        if previous is not None:along+=edges[tuple(sorted((previous[0],pair[0])))]
        width=edges[tuple(sorted(pair))]
        lower=vertex(pair[0],[along,0.,0.]);upper=vertex(pair[1],[along,width,0.])
        mapping.extend([lower,upper]);sew.append([lower,main[pair[0]]])
        if first_outer is None:first_outer=upper
        previous=pair
    require(ids[:2]==ids[-2:],'The admitted rib must already duplicate its closing row.')
    require(first_outer is not None,'Missing rib.')
    sew.append([mapping[-1],first_outer]);local_maps['neckband']=mapping
    faces=[];skipped=[];maximum=0.;seen=set()
    for part in p['parts']:
        for j in range(0,len(part['triangles']),3):
            local=part['triangles'][j:j+3];authored=[part['particles'][i] for i in local]
            if len(set(authored))<3:
                skipped.append({'part':part['part'],'render_triangle':j//3,'source_particles':authored,'reason':'collapsed-after-original-weld'});continue
            tri=[local_maps[part['part']][i] for i in local]
            for k in range(3):
                edge=tuple(sorted((authored[k],authored[(k+1)%3])));seen.add(edge)
                maximum=max(maximum,abs(math.dist(rest[tri[k]],rest[tri[(k+1)%3]])-edges[edge]))
            faces.append({'part':part['part'],'render_triangle':j//3,'vertices':tri,'authored_uv_m':[part['authored_uv_m'][2*i:2*i+2] for i in local]})
    require(seen==set(edges),'Mapped faces lost structural edges.')
    require(maximum<2e-6,'Cut-rib mapping changed the captured structural rest metric.')
    # Admit the equivalence relation itself, without claiming native finite
    # penalty stitches will enforce it or supply cross-seam hinge bending.
    parent=list(range(len(initial)))
    def root(i):
        while parent[i]!=i:i=parent[i]
        return i
    for a,b in sew:
        require(source_particles[a]==source_particles[b] and initial[a]==initial[b],'Unrelated or separated sewing pair.')
        parent[root(a)]=root(b)
    classes={}
    for i,source in enumerate(source_particles):classes.setdefault(source,set()).add(root(i))
    require(len(classes)==len(points) and all(len(group)==1 for group in classes.values()),'Sewing quotient differs from original welds.')
    return {'schema':'clothing-native-rest-candidate-v1','status':'candidate_rest_mapping_only','units':{'length':'m','authored_uv':'m'},'native_solver_executed':False,'native_abi_encoded':False,'seam_bending_admitted':False,'body_contact_admitted':False,'source_sha256':copy.deepcopy(envelope['source_sha256']),'source_particles':source_particles,'initial_positions_m':initial,'rest_positions_m':rest,'faces':faces,'skipped_render_faces':skipped,'sew_pairs':sew,'maximum_structural_rest_error_m':maximum,'body':copy.deepcopy(p['body']),'normalized_material_parameters':None,'limits':['Sewing pairs are semantic joins, not the upstream6-wide barycentric ABI or proven native contact exclusions.','Native finite-stiffness stitching and cross-seam bending are not browser weld/distance-bending equivalence.','Native rest-area mass differs from browser modelled-rib shell-area mass and needs an explicit comparison convention.','Native static body triangulation, triangle-interior clearance, contact initialization and two-material dynamics remain unverified.']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('packet',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args();raw=args.packet.read_bytes()
    candidate=build_mapping(json.loads(gzip.decompress(raw)));candidate['packet_sha256']=hashlib.sha256(raw).hexdigest()
    data=gzip.compress((json.dumps(candidate,separators=(',',':'),allow_nan=False)+'\n').encode(),compresslevel=9,mtime=0)
    with args.output.open('xb') as output:output.write(data)
    print(json.dumps({'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'vertices':len(candidate['initial_positions_m']),'faces':len(candidate['faces']),'sew_pairs':len(candidate['sew_pairs']),'maximum_structural_rest_error_m':candidate['maximum_structural_rest_error_m'],'status':candidate['status']},indent=2))
if __name__=='__main__':main()
