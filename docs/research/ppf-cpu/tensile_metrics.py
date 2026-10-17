"""Independent metre-based tensile measurements for #285."""
def strip():
    return ([[ -.015+c*.01,r*.01,0.] for r in range(21) for c in range(4)],
            [[r*4+c,r*4+c+1,(r+1)*4+c] for r in range(20) for c in range(3)]+[[r*4+c+1,(r+1)*4+c+1,(r+1)*4+c] for r in range(20) for c in range(3)])
import math

CASES={'soft':{'young-mod':500.,'density':1.},'stiff':{'young-mod':2000.,'density':1.},'density':{'young-mod':500.,'density':.18}}
PARAMETERS={'model':'baraff-witkin','poiss-rat':.3,'bend':1.,'strain-limit':0.,'deformation-damping':.02}
SESSION={'dt':.01,'fps':100.,'gravity':[0.,-100.,0.],'frames':150,'precond':'block-jacobi','disable-contact':True,'air-density':0.}

def measure(frames,rest):
    authored,_=strip()
    if rest!=authored or len(frames)!=151:raise ValueError('Require frozen rest and frames0..150.')
    for frame in frames:
        if len(frame)!=84 or any(len(v)!=3 or any(type(c) not in [int,float] or not math.isfinite(c) for c in v) for v in frame):raise ValueError('Require84 finite vertices per saved frame.')
    if max(math.dist(a,b) for a,b in zip(frames[0],rest))>1e-6:raise ValueError('Wrong initial rest frame.')
    def means(frame):return [sum(v[1] for v in frame[r*4:(r+1)*4])/4 for r in range(21)]
    initial=means(rest);gauge=initial[-1]-initial[0]
    final=means(frames[-1])
    local=max((row[i+1]-row[i])/(initial[i+1]-initial[i])-1 for row in map(means,frames) for i in range(20))
    return {'extension':(final[-1]-final[0])/gauge-1,'max_segment_strain':local,
            'clamp_drift_m':max(math.dist(frame[i],rest[i]) for frame in frames for i in range(80,84)),
            'final_window_step_m':max(math.dist(a,b) for before,after in zip(frames[-20:-1],frames[-19:]) for a,b in zip(before,after)),
            'final_window_extension_range':max((r[-1]-r[0])/gauge-1 for r in map(means,frames[-20:]))-min((r[-1]-r[0])/gauge-1 for r in map(means,frames[-20:])),
            'checked_vertex_frames':151*84}

def admit(cases):
    if set(cases)!=set(CASES):raise ValueError('Missing or extra material case.')
    for name,m in cases.items():
        if not all(type(v) in [int,float] and math.isfinite(v) for v in m.values()):raise ValueError('Nonfinite metric.')
        if not 0<m['extension']<.15:raise ValueError(name+': extension outside frozen admission.')
        if m['clamp_drift_m']>1e-6:raise ValueError(name+': clamp drift.')
        if m['final_window_step_m']>1e-5:raise ValueError(name+': not settled at saved-frame resolution.')
    if cases['soft']['extension']<=1.5*cases['stiff']['extension']:raise ValueError('Stiffness response not distinguishable.')
    if cases['density']['density_max_difference_m']>1e-4:raise ValueError('Density-only control differs beyond0.1mm.')
