"""Render exact saved native triangle geometry; no contact/physical-fit proof."""
import argparse,gzip,json,struct,zipfile
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('archive',type=Path);p.add_argument('out',type=Path);p.add_argument('--frames',type=int,nargs='+',default=[0,60,180]);a=p.parse_args()
with zipfile.ZipFile(a.archive) as z:
 data=json.loads(gzip.decompress(z.read('native-blueprint.json.gz')))
 body=np.asarray(data['body_vertices']);bodyfaces=np.asarray(data['body_faces']);faces=np.asarray(data['faces'])
 fig,axes=plt.subplots(2,len(a.frames),figsize=(4.2*len(a.frames),10),squeeze=False,sharex=True,sharey=True)
 for row,(name,young) in enumerate([('soft',500),('stiff',2000)]):
  for col,index in enumerate(a.frames):
   values=struct.unpack('<7059f',z.read(f'native-cache/sessions/cpu-garment-{name}/session/output/vert_{index}.bin'));cloth=np.asarray(values).reshape(-1,3)
   triangles=np.concatenate([body[bodyfaces],cloth[faces]])
   normals=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0]);length=np.linalg.norm(normals,axis=1);normals/=np.maximum(length[:,None],1e-16)
   light=np.asarray([.3,.6,1.]);light/=np.linalg.norm(light)
   shade=.50+.5*np.abs(normals@light)
   colors=np.repeat(np.asarray([[.75,.78,.80]]),len(triangles),axis=0);colors[len(bodyfaces):]=[.18,.53,.77]
   for i,source in enumerate(data['face_source']):
    if source['part']=='neckband':colors[len(bodyfaces)+i]=[.10,.27,.38]
   colors*=shade[:,None];order=np.argsort(triangles[:,:,2].mean(axis=1),kind='stable');ax=axes[row,col]
   ax.add_collection(PolyCollection(triangles[order,:,:2],facecolors=colors[order],edgecolors='none',rasterized=True))
   ax.set(xlim=(-.44,.44),ylim=(-.04,1.06),aspect='equal',title=f'Young {young} · saved t={index/60:g}s',xlabel='x (m)')
   if col==0:ax.set_ylabel('y (m)')
   ax.set_facecolor('#f8fafc');ax.spines[['top','right']].set_visible(False)
 fig.suptitle('Exact saved native garment geometry · front orthographic view',fontsize=16)
 fig.text(.5,.015,'Same preparation, rest, captured inertia, seams and body. Normalized Young only differs.\nTriangle-depth projection is illustrative; it does not verify continuous contact, settling or physical fit.',ha='center',fontsize=10)
 fig.tight_layout(rect=(0,.055,1,.96));fig.savefig(a.out,dpi=140);plt.close(fig)
