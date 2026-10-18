"""Explicit faceted analytic-body candidate, not native contact acceptance.

Marching tetrahedra samples the captured body's actual analytic field. An
explicit cap at-0.6m closes the otherwise downward-unbounded torso. This is a
new approximate collider representation, not an anatomical reconstruction.
"""
import argparse
import copy
import gzip
import hashlib
import json
import math
from pathlib import Path
from garment_admission import audit,body_gap,require


def extract_surface(field,bounds,step):
    require(type(step) in (float,int) and math.isfinite(step) and step>0,'Invalid grid step.')
    require(len(bounds)==2 and all(len(p)==3 and all(math.isfinite(n) for n in p) for p in bounds),'Invalid bounds.')
    require(all(bounds[1][i]>bounds[0][i] for i in range(3)),'Reversed bounds.')
    size=[math.ceil((bounds[1][i]-bounds[0][i])/step)+1 for i in range(3)]
    require(math.prod(size)<=500000,'Grid exceeds bounded research allocation.')
    nx,ny,nz=size;nodes=[];values=[]
    for x in range(nx):
        for y in range(ny):
            for z in range(nz):
                p=[bounds[0][0]+x*step,bounds[0][1]+y*step,bounds[0][2]+z*step]
                value=field(p);require(math.isfinite(value),'Nonfinite sampled field.')
                # Avoid zero-endpoint duplicate roots/zero-area facets without
                # hiding a clipped surface: this shifts exact zeros by ≤1pm.
                if abs(value)<1e-12:value=1e-12
                if x in (0,nx-1) or y in (0,ny-1) or z in (0,nz-1):require(value>0,'Surface clipped by grid bounds.')
                nodes.append(p);values.append(value)
    vertices=[];faces=[];edge_vertices={}
    def crossing(a,b):
        key=tuple(sorted((a,b)))
        if key not in edge_vertices:
            t=values[a]/(values[a]-values[b]);edge_vertices[key]=len(vertices)
            vertices.append([nodes[a][i]+t*(nodes[b][i]-nodes[a][i]) for i in range(3)])
        return edge_vertices[key]
    def face(ids,direction):
        a,b,c=[vertices[i] for i in ids];u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
        normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
        require(sum(x*x for x in normal)>0,'Collapsed sampled facet.')
        if sum(normal[i]*direction[i] for i in range(3))<0:ids=[ids[0],ids[2],ids[1]]
        faces.append(ids)
    # Six tetrahedra around the shared000->111 diagonal. Identical face
    # diagonals across neighboring cubes make shared roots watertight.
    tets=((0,1,3,7),(0,3,2,7),(0,2,6,7),(0,6,4,7),(0,4,5,7),(0,5,1,7))
    for x in range(nx-1):
        for y in range(ny-1):
            for z in range(nz-1):
                cube=[((x+dx)*ny+y+dy)*nz+z+dz for dx,dy,dz in ((0,0,0),(0,0,1),(0,1,0),(0,1,1),(1,0,0),(1,0,1),(1,1,0),(1,1,1))]
                if all(values[i]>0 for i in cube) or all(values[i]<0 for i in cube):continue
                for tet in tets:
                    inside=[cube[i] for i in tet if values[cube[i]]<0];outside=[cube[i] for i in tet if values[cube[i]]>0]
                    if not inside or not outside:continue
                    direction=[sum(nodes[j][i] for j in outside)/len(outside)-sum(nodes[j][i] for j in inside)/len(inside) for i in range(3)]
                    if len(inside)==1:face([crossing(inside[0],j) for j in outside],direction)
                    elif len(outside)==1:face([crossing(outside[0],j) for j in inside],direction)
                    else:
                        a,b,c,d=[crossing(i,j) for i in inside for j in outside]
                        face([a,b,c],direction);face([b,d,c],direction)
    require(vertices and faces,'Empty sampled surface.')
    # Admit closure and orientation independently of the marching case table.
    edges={};volume=0.
    for a,b,c in faces:
        u,v,w=vertices[a],vertices[b],vertices[c]
        volume+=sum(u[i]*(v[(i+1)%3]*w[(i+2)%3]-v[(i+2)%3]*w[(i+1)%3]) for i in range(3))/6
        for i,j in ((a,b),(b,c),(c,a)):edges.setdefault(tuple(sorted((i,j))),[]).append((i,j))
    require(all(len(e)==2 and e[0]==e[1][::-1] for e in edges.values()),'Sampled surface is not closed/oriented.')
    require(volume>0,'Inverted sampled surface.')
    return {'vertices_m':vertices,'triangles':faces,'signed_volume_m3':volume,'grid_origin_m':bounds[0][:],'grid_shape':size,'grid_step_m':step}


def mesh_body(body):
    step=.02;cap=-.6
    lower=[-max(s['halfWidth'] for s in body['torso_m']),cap,-max(s['halfDepth'] for s in body['torso_m'])]
    upper=[-lower[0],body['torso_m'][0]['y'],-lower[2]]
    for c in body['capsules_m']:
        for centre,radius in ((c['a'],c['radius']),(c['b'],c['end'])):
            for i in range(3):lower[i]=min(lower[i],centre[i]-radius);upper[i]=max(upper[i],centre[i]+radius)
    lower[1]=cap
    # A fixed asymmetric pad avoids alignment of the explicit cap and grid.
    bounds=[[n-step*1.14159 for n in lower],[n+step*1.27183 for n in upper]]
    field=lambda point:max(body_gap(point,body),cap-point[1])
    mesh=extract_surface(field,bounds,step)
    mesh.update(schema='clothing-native-body-candidate-v1',status='candidate_closed_body_mesh_only',source_body=copy.deepcopy(body),step_m=step,lower_cap_y_m=cap,native_solver_executed=False,garment_triangle_contact_admitted=False,maximum_vertex_field_residual_m=max(abs(field(p)) for p in mesh['vertices_m']),limits=['2cm sampled faceted approximation of the existing analytic proxy, not an anatomical avatar.','The source torso extends below its last section; explicit-0.6m cap closes it below the garment.','Closed orientation is checked, but triangle self-intersection, geometric convergence, native contact and garment triangle clearance remain unverified.'])
    return mesh


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('packet',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args();raw=args.packet.read_bytes();envelope=json.loads(gzip.decompress(raw))
    audit(envelope);mesh=mesh_body(envelope['packet']['body']);mesh['packet_sha256']=hashlib.sha256(raw).hexdigest()
    data=gzip.compress((json.dumps(mesh,separators=(',',':'),allow_nan=False)+'\n').encode(),compresslevel=9,mtime=0)
    with args.output.open('xb') as output:output.write(data)
    print(json.dumps({'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'vertices':len(mesh['vertices_m']),'triangles':len(mesh['triangles']),'signed_volume_m3':mesh['signed_volume_m3'],'maximum_vertex_field_residual_m':mesh['maximum_vertex_field_residual_m'],'status':mesh['status']},indent=2))
if __name__=='__main__':main()
