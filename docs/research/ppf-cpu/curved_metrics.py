"""Independent convex-polyhedron/sheet oracle, in metres, for #282 saved states.

Clip full cloth triangles, not merely their vertices, against the actual body's
inward-offset halfspaces. This measures the faceted body, not an analytic sphere,
and does not establish continuous-time contact or physical fabric accuracy.
"""
import math
from collections import Counter

def dot(a,b):return sum(x*y for x,y in zip(a,b))
def finite(point):return len(point)==3 and all(type(x) in [int,float] and math.isfinite(x) for x in point)

def body_planes(vertices,faces):
    if not vertices or not faces or not all(finite(v) for v in vertices):raise ValueError('Invalid body coordinates.')
    edges=Counter();planes=[]
    for face in faces:
        if len(face)!=3 or len(set(face))!=3 or any(type(i) is not int or not 0<=i<len(vertices) for i in face):raise ValueError('Invalid body triangle.')
        a,b,c=[vertices[i] for i in face];u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
        normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];length=math.sqrt(dot(normal,normal))
        if length<1e-12:raise ValueError('Degenerate body triangle.')
        normal=[x/length for x in normal];distance=dot(normal,a)
        if max(dot(normal,v)-distance for v in vertices)>1e-8:raise ValueError('Body must be convex with outward triangles.')
        planes.append((normal,distance))
        for x,y in zip(face,face[1:]+face[:1]):edges[x,y]+=1
    if any(count!=1 or edges[y,x]!=1 for (x,y),count in edges.items()):raise ValueError('Body must be a closed consistently wound manifold.')
    return planes

def clip_triangle(triangle,planes,tolerance=1e-6):
    polygon=triangle
    for normal,distance in planes:
        if not polygon:return []
        bound=distance-tolerance;result=[];previous=polygon[-1];prev=dot(normal,previous)-bound
        for current in polygon:
            value=dot(normal,current)-bound
            if (value<=0)!=(prev<=0):
                t=prev/(prev-value);result.append([previous[i]+t*(current[i]-previous[i]) for i in range(3)])
            if value<=0:result.append(current)
            previous=current;prev=value
        polygon=result
    return polygon

def measure(frames,cloth_faces,planes):
    if len(frames)!=19 or not planes:raise ValueError('Require frames0..18 and convex body planes.')
    if len(cloth_faces)!=128 or any(len(f)!=3 or any(type(i) is not int or not 0<=i<81 for i in f) for f in cloth_faces):raise ValueError('Require128 cloth triangles.')
    inside=0;crossings=0;first=None;gap=math.inf
    for index,frame in enumerate(frames):
        if len(frame)!=81 or not all(finite(v) for v in frame):raise ValueError('Require81 finite solved vertices.')
        if index==0 and any(abs(v[1]-1.13)>1e-6 for v in frame):raise ValueError('Wrong initial sheet height.')
        for point in frame:
            separation=max(dot(n,point)-d for n,d in planes);gap=min(gap,separation)
            if separation < -1e-6:inside+=1
        for face in cloth_faces:
            if clip_triangle([frame[i] for i in face],planes):
                crossings+=1
                if first is None:first=index
    mean=lambda f:sum(v[1] for v in f)/81
    return {'inside_vertex_frames':inside,'penetrating_triangle_frames':crossings,'first_penetrating_frame':first,'minimum_halfspace_separation':gap,'mean_descent':mean(frames[0])-mean(frames[-1]),'final_height_range':max(v[1] for v in frames[-1])-min(v[1] for v in frames[-1]),'checked_vertex_frames':19*81,'checked_triangle_frames':19*128}

def admit(held,through):
    freefall=.5*9.8*.3**2
    if through['penetrating_triangle_frames']<=0 or through['inside_vertex_frames']<=0 or through['mean_descent']<=.8*freefall:raise ValueError('Disabled-contact control did not cross the curved body.')
    if held['inside_vertex_frames'] or held['penetrating_triangle_frames']:raise ValueError('Enabled sheet penetrates the curved body at a saved state.')
    if not .25*.03<held['mean_descent']<.6*freefall:raise ValueError('Enabled sheet did not move and stop meaningfully.')
    if held['final_height_range']<=.005:raise ValueError('Enabled sheet did not form a nonplanar drape.')
