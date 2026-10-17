"""Frozen metre-scale meshes for #282; synthetic sphere is not an anatomical avatar."""
import math

def sheet():
    points=[[x*.03-.12,1.13,z*.03-.12] for x in range(9) for z in range(9)]
    faces=[]
    for x in range(8):
        for z in range(8):
            a=x*9+z;faces.extend([[a,a+1,a+9],[a+1,a+10,a+9]])
    return points,faces

def sphere():
    points=[[0.,1.1,0.]]
    for ring in range(1,8):
        phi=math.pi*ring/8
        for j in range(16):
            theta=2*math.pi*j/16
            points.append([.2*math.sin(phi)*math.cos(theta),.9+.2*math.cos(phi),.2*math.sin(phi)*math.sin(theta)])
    points.append([0.,.7,0.]);bottom=len(points)-1;faces=[]
    for j in range(16):faces.extend([[0,1+j,1+(j+1)%16],[bottom,1+6*16+(j+1)%16,1+6*16+j]])
    for ring in range(6):
        for j in range(16):
            a=1+ring*16+j;b=1+ring*16+(j+1)%16;c=a+16;d=b+16
            faces.extend([[a,b,c],[b,d,c]])
    for face in faces:
        a,b,c=[points[i] for i in face];u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
        n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
        if sum(n[i]*(a[i]-[0,.9,0][i]) for i in range(3))<0:face.reverse()
    return points,faces
