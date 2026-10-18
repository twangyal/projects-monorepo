"""Declared contact-compatible candidate initializer; native admission still required."""
import copy
import math
from garment_admission import require

RIB_OFFSET_M=.005
CUT_HALF_GAP_M=.002
CLOTH_OFFSET_M=.00025
BODY_OFFSET_M=.00325


def separate_rib(inputs):
    result=copy.deepcopy(inputs);points=inputs['initial'];rib_faces=[f for f,s in zip(inputs['faces'],inputs['face_source']) if s['part']=='neckband'];rib={i for f in rib_faces for i in f}
    normals={i:[0.,0.,0.] for i in rib};neighbors={i:set() for i in rib}
    for a,b,c in rib_faces:
        u=[points[b][i]-points[a][i] for i in range(3)];v=[points[c][i]-points[a][i] for i in range(3)]
        n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
        for vertex in (a,b,c):
            normals[vertex]=[normals[vertex][i]+n[i] for i in range(3)];neighbors[vertex].update({a,b,c}-{vertex})
    for vertex,n in normals.items():
        length=math.hypot(*n);require(length>1e-12,'Undefined collar normal.')
        n=[v/length for v in n]
        if n[0]*points[vertex][0]+n[2]*points[vertex][2]<0:n=[-v for v in n]
        result['initial'][vertex]=[points[vertex][i]+RIB_OFFSET_M*n[i] for i in range(3)]
    first_inner=inputs['stitch_indices'][0][0];last_inner=inputs['stitch_indices'][-2][0]
    last_outer=inputs['stitch_indices'][-1][0];first_outer=inputs['stitch_indices'][-1][3]
    def mean(vertex):return [sum(points[j][i] for j in sorted(neighbors[vertex]))/len(neighbors[vertex]) for i in range(3)]
    first,last=mean(first_outer),mean(last_outer);t=[first[i]-last[i] for i in range(3)];length=math.hypot(*t);require(length>1e-12,'Undefined closing-cut tangent.');t=[v/length for v in t]
    for vertex,sign in [(first_inner,1),(first_outer,1),(last_inner,-1),(last_outer,-1)]:
        result['initial'][vertex]=[result['initial'][vertex][i]+sign*CUT_HALF_GAP_M*t[i] for i in range(3)]
    require(all(math.dist(result['initial'][s[0]],result['initial'][s[3]])>.0015 for s in inputs['stitch_indices']),'Initialized seam remains inside the declared cloth gap/padding.')
    return result
