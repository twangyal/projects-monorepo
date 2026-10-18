"""Saved-frame kinematics and intrinsic edge strain, not cloth/fit acceptance."""
import math
from garment_admission import require


def measure(inputs,frames):
    count=len(inputs['initial']);require(len(frames)>=2,'Require initial and solved frames.')
    for frame in frames:
        require(len(frame)==count and all(len(p)==3 and all(math.isfinite(v) for v in p) for p in frame),'Incomplete/nonfinite vertex frame.')
    require(max(math.dist(p,q) for p,q in zip(frames[0],inputs['initial']))<=2e-7,'Saved initial frame differs from declared initialization.')
    edges={tuple(sorted((f[i],f[(i+1)%3]))) for f in inputs['faces'] for i in range(3)}
    rest={edge:math.dist(inputs['rest'][edge[0]],inputs['rest'][edge[1]]) for edge in sorted(edges)}
    require(rest and all(v>1e-12 for v in rest.values()),'Degenerate intrinsic edge.')
    def strain(frame):return max(abs(math.dist(frame[a],frame[b])/length-1.) for (a,b),length in rest.items())
    def seam(frame):return max((math.dist(frame[s[0]],frame[s[3]]) for s in inputs['stitch_indices']),default=0.)
    strains=[strain(frame) for frame in frames];gaps=[seam(frame) for frame in frames]
    movement=max(math.dist(p,q) for frame in frames[1:] for p,q in zip(frame,frames[0]))
    final_rms=math.sqrt(sum(math.dist(p,q)**2 for p,q in zip(frames[-1],frames[0]))/count)
    return {'saved_frames':len(frames),'vertices_per_frame':count,'unique_intrinsic_edges':len(rest),'maximum_vertex_displacement_m':movement,'final_vertex_rms_displacement_m':final_rms,'initial_maximum_absolute_edge_strain':strains[0],'maximum_saved_absolute_edge_strain':max(strains),'final_maximum_absolute_edge_strain':strains[-1],'initial_maximum_stitch_gap_m':gaps[0],'maximum_saved_stitch_gap_m':max(gaps),'final_maximum_stitch_gap_m':gaps[-1],'scope':'Saved-frame vertex/edge/seam diagnostics only; no continuous-time collision, settling, physical-material or fit acceptance.'}
