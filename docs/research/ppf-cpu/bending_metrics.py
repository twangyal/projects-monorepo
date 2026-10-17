"""Frozen metre-based cantilever oracle (#287); no physical calibration."""
import math
CASES={'soft':{'bend':1.},'stiff':{'bend':1000.}}
PARAMETERS={'model':'baraff-witkin','young-mod':100000.,'density':1.,'poiss-rat':.3,'strain-limit':0.,'deformation-damping':.02,'bending-damping':.05}
SESSION={'dt':.01,'fps':100.,'gravity':[0.,-9.8,0.],'frames':400,'precond':'block-jacobi','disable-contact':True,'air-density':0.}
def strip():
    vertices=[[r*.01,0.,-.015+c*.01] for r in range(11) for c in range(4)]
    faces=[]
    for r in range(10):
        for c in range(3):
            a=r*4+c;faces.extend([[a,a+1,a+4],[a+1,a+5,a+4]])
    return vertices,faces
def measure(frames,rest):
    authored,faces=strip()
    if rest!=authored or len(frames)!=401:raise ValueError('Require frozen rest and frames0..400.')
    for f in frames:
        if len(f)!=44 or any(len(v)!=3 or any(type(c) not in [int,float] or not math.isfinite(c) for c in v) for v in f):raise ValueError('Require44 finite vertices per saved frame.')
    if max(math.dist(a,b) for a,b in zip(frames[0],rest))>1e-6:raise ValueError('Wrong initial rest.')
    edges={tuple(sorted((f[i],f[(i+1)%3]))) for f in faces for i in range(3)}
    return {'tip_descent_m':-sum(v[1] for v in frames[-1][40:44])/4,
            'clamp_drift_m':max(math.dist(f[i],rest[i]) for f in frames for i in range(8)),
            'max_edge_strain':max(math.dist(f[a],f[b])/math.dist(rest[a],rest[b])-1 for f in frames for a,b in edges),
            'final_window_step_m':max(math.dist(a,b) for x,y in zip(frames[-20:-1],frames[-19:]) for a,b in zip(x,y)),
            'checked_vertex_frames':401*44}
def admit(cases):
    if set(cases)!=set(CASES):raise ValueError('Wrong case set.')
    for name,m in cases.items():
        if any(type(v) not in [int,float] or not math.isfinite(v) for v in m.values()):raise ValueError('Nonfinite metric.')
        if m['clamp_drift_m']>1e-6 or m['final_window_step_m']>1e-5 or m['max_edge_strain']>.02:raise ValueError(name+': clamp/settling/strain gate failed.')
    soft=cases['soft']['tip_descent_m'];stiff=cases['stiff']['tip_descent_m']
    if not .04<soft<.11 or not 0<stiff<.03 or not soft>2*stiff:raise ValueError('Bending response not distinguishable within frozen bounds.')
