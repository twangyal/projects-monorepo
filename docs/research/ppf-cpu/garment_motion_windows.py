"""Saved-interval secant speed windows; no instantaneous velocity/settling claim."""
import math
from garment_admission import require

def saved_motion_windows(frames,dt=1/60,intervals_per_window=60):
 require(math.isfinite(dt) and dt>0 and type(intervals_per_window) is int and intervals_per_window>0,'Invalid saved window controls.')
 require(len(frames)>1 and (len(frames)-1)%intervals_per_window==0,'Incomplete saved window.')
 vertices=len(frames[0]);require(vertices>0,'Empty saved frame.')
 require(all(len(f)==vertices and all(len(p)==3 and all(math.isfinite(v) for v in p) for p in f) for f in frames),'Incomplete/nonfinite saved vertices.')
 result=[]
 for start in range(0,len(frames)-1,intervals_per_window):
  end=start+intervals_per_window
  squared=[(math.dist(p,q)/dt)**2 for a,b in zip(frames[start:end],frames[start+1:end+1]) for p,q in zip(a,b)]
  result.append({'start_seconds':start*dt,'end_seconds':end*dt,'saved_intervals':intervals_per_window,'maximum_secant_speed_m_s':math.sqrt(max(squared)),'rms_secant_speed_m_s':math.sqrt(math.fsum(squared)/len(squared))})
 return result
