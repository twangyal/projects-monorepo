"""Independent finite-plane oracle for the frozen #281 static mesh drop (metres).

Checks saved states, not continuous-time nonpenetration or physical fabric accuracy.
"""
import math

def measure(frames):
    if len(frames)!=13:raise ValueError('Expected exactly saved frames 0..12.')
    wrong=0;first=None;clearance=math.inf;covered=0
    for index,frame in enumerate(frames):
        if len(frame)!=25:raise ValueError('Expected 25 solved upper-sheet vertices; the static collider must not be solved cloth.')
        for point in frame:
            if len(point)!=3 or not all(type(v) in [int,float] and math.isfinite(v) for v in point):raise ValueError('Nonfinite or malformed native coordinate.')
            x,y,z=point
            if abs(x)>.2+1e-6 or abs(z)>.2+1e-6:raise ValueError('A solved vertex left the finite static plane footprint; contact coverage lost.')
            if index==0 and abs(y-1.03)>1e-6:raise ValueError('Initial sheet is not at the frozen 30 mm drop height.')
            covered+=1;gap=y-1.;clearance=min(clearance,gap)
            if gap < -1e-6:
                wrong+=1
                if first is None:first=index
    mean=lambda frame:sum(point[1] for point in frame)/len(frame)
    return{'wrong_side':wrong,'first_wrong_side':first,'min_clearance':clearance,'descent':mean(frames[0])-mean(frames[-1]),'covered_vertex_frames':covered}

def admit(held,through):
    free_fall=.5*9.8*.2**2
    if through['wrong_side']<=0 or through['descent']<=.8*free_fall:raise ValueError('Disabled-contact control did not fall through the static mesh.')
    if held['wrong_side']!=0 or held['min_clearance'] < -1e-6:raise ValueError('Contact-enabled output penetrated the static plane.')
    if not .25*.03 < held['descent'] < .6*free_fall:raise ValueError('Enabled sheet did not move and meaningfully stop at the collider.')
