"""Conservative detached collar sewing layout; not an accepted dressed pose."""
import copy
import math
from garment_admission import require
from garment_native_initialization import CLOTH_OFFSET_M,BODY_OFFSET_M,CUT_HALF_GAP_M

CONTACT_GAP_M=.001
NUMERICAL_MARGIN_M=1e-6


def bounds(points):
    return ([min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)])


def required_rise(collar,obstacles,clearance):
    """Sufficient +Y translation: XZ-disjoint triangles need no Y constraint."""
    rise=0.
    for low,high in collar:
        for other_low,other_high in obstacles:
            if all(low[k]<=other_high[k]+clearance and other_low[k]<=high[k]+clearance for k in [0,2]):
                rise=max(rise,other_high[1]+clearance-low[1])
    return rise


def sewing_layout(inputs):
    result=copy.deepcopy(inputs);points=result['initial']
    rib_faces=[f for f,s in zip(inputs['faces'],inputs['face_source']) if s['part']=='neckband'];rib={i for f in rib_faces for i in f}
    require(len(rib)==42 and len(inputs['stitch_indices'])==22,'Require frozen cut-rib topology.')
    neighbors={i:set() for i in rib}
    for a,b,c in rib_faces:
        for v in [a,b,c]:neighbors[v].update({a,b,c}-{v})
    first_inner=inputs['stitch_indices'][0][0];last_inner=inputs['stitch_indices'][-2][0]
    last_outer=inputs['stitch_indices'][-1][0];first_outer=inputs['stitch_indices'][-1][3]
    def mean(v):return [sum(points[j][i] for j in sorted(neighbors[v]))/len(neighbors[v]) for i in range(3)]
    first,last=mean(first_outer),mean(last_outer)
    tangent=[first[0]-last[0],0.,first[2]-last[2]];length=math.hypot(*tangent);require(length>1e-12,'Undefined cut tangent.')
    for v,sign in [(first_inner,1),(first_outer,1),(last_inner,-1),(last_outer,-1)]:
        points[v]=[points[v][i]+sign*CUT_HALF_GAP_M*tangent[i]/length for i in range(3)]
    collar=[bounds([points[i] for i in f]) for f in rib_faces]
    cloth=[bounds([points[i] for i in f]) for f,s in zip(inputs['faces'],inputs['face_source']) if s['part']!='neckband']
    body=[bounds([inputs['body_vertices'][i] for i in f]) for f in inputs['body_faces']]
    # Sum both gap contributions conservatively; native's own gate still decides admission.
    cloth_gap=2*CLOTH_OFFSET_M+2*CONTACT_GAP_M
    body_gap=CLOTH_OFFSET_M+BODY_OFFSET_M+2*CONTACT_GAP_M
    rise=max(required_rise(collar,cloth,cloth_gap),required_rise(collar,body,body_gap))+NUMERICAL_MARGIN_M
    for v in rib:points[v][1]+=rise
    return result,{'method':'cut-open-aabb-separated-collar-v1','collar_rise_m':rise,'cloth_pair_clearance_m':cloth_gap,'body_pair_clearance_m':body_gap,'numerical_margin_m':NUMERICAL_MARGIN_M,'cut_half_gap_m':CUT_HALF_GAP_M,'cut_pair_gap_m':math.dist(points[first_outer],points[last_outer]),'collar_vertices':len(rib),'collar_triangles':len(rib_faces),'obstacle_cloth_triangles':len(cloth),'obstacle_static_triangles':len(body),'scope':'Conservative collar-to-shirt/body initial separation only. Native self-contact/export/solver admission and sewn pose remain unverified.'}
