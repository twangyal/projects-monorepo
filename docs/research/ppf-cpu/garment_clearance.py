"""Research-only outward preparation and conservative triangle-pair clearance.

Distances use float32-rounded positions as the CPU backend does. This is an
initial cloth/body surface-distance gate, not motion or cloth self-contact.
"""
import copy,itertools,math,struct
from garment_admission import body_gap,require
OUTWARD_OFFSET_M=.005
REQUIRED_CLEARANCE_M=.006

def sub(a,b):return (a[0]-b[0],a[1]-b[1],a[2]-b[2])
def dot(a,b):return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
def cross(a,b):return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def mix(a,b,t):return (a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]),a[2]+t*(b[2]-a[2]))
def closest(p,a,b,c):
 ab,ac,ap=sub(b,a),sub(c,a),sub(p,a);d1,d2=dot(ab,ap),dot(ac,ap)
 if d1<=0 and d2<=0:return a
 bp=sub(p,b);d3,d4=dot(ab,bp),dot(ac,bp)
 if d3>=0 and d4<=d3:return b
 vc=d1*d4-d3*d2
 if vc<=0 and d1>=0 and d3<=0:return mix(a,b,d1/(d1-d3))
 cp=sub(p,c);d5,d6=dot(ab,cp),dot(ac,cp)
 if d6>=0 and d5<=d6:return c
 vb=d5*d2-d1*d6
 if vb<=0 and d2>=0 and d6<=0:return mix(a,c,d2/(d2-d6))
 va=d3*d6-d5*d4
 if va<=0 and d4-d3>=0 and d5-d6>=0:return mix(b,c,(d4-d3)/((d4-d3)+(d5-d6)))
 total=va+vb+vc;require(total>0,'Degenerate triangle in clearance query.')
 v,w=vb/total,vc/total
 return (a[0]+ab[0]*v+ac[0]*w,a[1]+ab[1]*v+ac[1]*w,a[2]+ab[2]*v+ac[2]*w)
def segment_squared(p,q,a,b):
 u,v,w=sub(q,p),sub(b,a),sub(p,a);aa,bb,cc,dd,ee=dot(u,u),dot(u,v),dot(v,v),dot(u,w),dot(v,w)
 if aa<=1e-24:return sum(x*x for x in sub(p,mix(a,b,min(1,max(0,ee/cc)) if cc>1e-24 else 0)))
 if cc<=1e-24:return sum(x*x for x in sub(a,mix(p,q,min(1,max(0,-dd/aa)))))
 den=aa*cc-bb*bb;s=min(1,max(0,(bb*ee-cc*dd)/den)) if den>1e-24 else 0.
 t=(bb*s+ee)/cc
 if t<0:t=0.;s=min(1,max(0,-dd/aa))
 elif t>1:t=1.;s=min(1,max(0,(bb-dd)/aa))
 d=sub(mix(p,q,s),mix(a,b,t));return dot(d,d)
def pierces(p,q,a,b,c):
 direction=sub(q,p);e1,e2=sub(b,a),sub(c,a);h=cross(direction,e2);det=dot(e1,h)
 if abs(det)<1e-20:return False
 inv=1/det;s=sub(p,a);u=inv*dot(s,h)
 if u<0 or u>1:return False
 v=inv*dot(direction,cross(s,e1))
 if v<0 or u+v>1:return False
 t=inv*dot(e2,cross(s,e1));return 0<=t<=1

def triangle_distance_squared(a,b):
 edges=((0,1),(1,2),(2,0))
 if any(pierces(a[i],a[j],*b) or pierces(b[i],b[j],*a) for i,j in edges):return 0.
 minimum=math.inf
 for p in a:
  d=sub(p,closest(p,*b));minimum=min(minimum,dot(d,d))
 for p in b:
  d=sub(p,closest(p,*a));minimum=min(minimum,dot(d,d))
 for i,j in edges:
  for k,l in edges:minimum=min(minimum,segment_squared(a[i],a[j],b[k],b[l]))
 return minimum

def bounds(triangle):return tuple(min(p[i] for p in triangle) for i in range(3)),tuple(max(p[i] for p in triangle) for i in range(3))
def cells(low,high,step):return itertools.product(*(range(math.floor(low[i]/step),math.floor(high[i]/step)+1) for i in range(3)))
def surface_clearance(inputs,required_m):
 require(type(required_m) in (int,float) and math.isfinite(required_m) and 0<required_m<=.02,'Invalid research clearance radius.')
 require(all(inputs.get(k) for k in ['initial','faces','body_vertices','body_faces']),'Empty clearance mesh.')
 f=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
 points=[tuple(map(f,p)) for p in inputs['initial']];body=[tuple(map(f,p)) for p in inputs['body_vertices']]
 require(all(math.isfinite(v) for p in points+body for v in p),'Nonfinite clearance coordinates.')
 body_triangles=[[body[i] for i in face] for face in inputs['body_faces']];body_bounds=[bounds(t) for t in body_triangles]
 step=.02;grid={}
 for j,(low,high) in enumerate(body_bounds):
  for cell in cells(low,high,step):grid.setdefault(cell,[]).append(j)
 minimum=math.inf;witness=None;violations=0;tested=0;threshold=required_m**2
 for i,face in enumerate(inputs['faces']):
  triangle=[points[v] for v in face];low,high=bounds(triangle)
  ids=set()
  for cell in cells([v-required_m for v in low],[v+required_m for v in high],step):ids.update(grid.get(cell,()))
  for j in sorted(ids):
   bl,bh=body_bounds[j]
   lower=sum(max(0,low[k]-bh[k],bl[k]-high[k])**2 for k in range(3))
   if lower>=threshold:continue
   tested+=1;distance=triangle_distance_squared(triangle,body_triangles[j])
   if distance<minimum:minimum=distance;witness={'cloth_triangle':i,'body_triangle':j}
   if distance<threshold:violations+=1
 return {'method':'float32-triangle-surface-distance-spatial-hash-v1','required_clearance_m':required_m,'violations':violations,'minimum_separation_m':math.sqrt(minimum) if minimum<threshold else None,'clearance_lower_bound_m':required_m if violations==0 else math.sqrt(minimum),'tested_triangle_pairs':tested,'witness':witness if violations else None,'scope':'Complete threshold cloth/body triangle-pair query including vertex-face, edge-edge and intersections; not cloth self-contact, inside/outside or trajectory acceptance.'}

def outward_preparation(inputs,body):
 result=copy.deepcopy(inputs);epsilon=1e-5
 for i,point in enumerate(inputs['initial']):
  gradient=[]
  for k in range(3):
   a=list(point);b=list(point);a[k]+=epsilon;b[k]-=epsilon;gradient.append((body_gap(a,body)-body_gap(b,body))/(2*epsilon))
  length=math.hypot(*gradient);require(math.isfinite(length) and length>1e-8,'Undefined body-field outward direction.')
  result['initial'][i]=[point[k]+OUTWARD_OFFSET_M*gradient[k]/length for k in range(3)]
 return result,{'method':'captured-analytic-body-gradient-outward-v1','outward_offset_m':OUTWARD_OFFSET_M,'gradient_epsilon_m':epsilon,'required_mesh_clearance_m':REQUIRED_CLEARANCE_M,'scope':'Explicit initial-geometry preconditioning only; rest, mass, seams and body unchanged.'}
