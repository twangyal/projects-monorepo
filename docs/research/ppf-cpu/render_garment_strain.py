"""Render saved native edge strain on exact garment triangles; not physical fit.

Optional NumPy/Matplotlib illustration. Run the independent archive audit first.
Default color is each triangle's largest absolute intrinsic-edge strain on a
0–35% scale. Explicit principal mode uses any in-plane direction and0–45%.
Triangle-depth sorting is an approximate orthographic projection.
"""
import argparse,gzip,io,json,struct,zipfile
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
from matplotlib.cm import ScalarMappable
from matplotlib.colors import Normalize
from garment_archive_storage import read_archive
from garment_construction_diagnostics import construction_diagnostics
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('soft_archive',type=Path);p.add_argument('stiff_archive',type=Path);p.add_argument('out',type=Path)
p.add_argument('--frame',type=int,default=180);p.add_argument('--metric',choices=['edge','principal'],default='edge');a=p.parse_args()
fig,axes=plt.subplots(2,2,figsize=(10,11),sharex=True,sharey=True)
norm=Normalize(0,.45 if a.metric=='principal' else .35);cmap=plt.get_cmap('magma')
for row,(name,archive) in enumerate([('soft',a.soft_archive),('stiff',a.stiff_archive)]):
 with zipfile.ZipFile(io.BytesIO(read_archive(archive))) as z:
  data=json.loads(gzip.decompress(z.read('native-blueprint.json.gz')))
  raw=z.read(f'native-cache/sessions/cpu-garment-{name}/session/output/vert_{a.frame}.bin')
  cloth=np.array(struct.unpack('<7059f',raw)).reshape(-1,3)
  faces=np.asarray(data['faces']);rest=np.asarray(data['rest']);body=np.asarray(data['body_vertices']);bodyfaces=np.asarray(data['body_faces'])
  strain=np.zeros(len(faces))
  for i in range(3):
   va,vb=faces[:,i],faces[:,(i+1)%3]
   strain=np.maximum(strain,np.abs(np.linalg.norm(cloth[va]-cloth[vb],axis=1)/np.linalg.norm(rest[va]-rest[vb],axis=1)-1))
  if a.metric=='principal':
   from garment_principal_strain import triangle_strain
   strain=np.array([triangle_strain(rest[face].tolist(),cloth[face].tolist())['maximum_absolute_principal_strain'] for face in faces])
  diagnostic=construction_diagnostics(data,cloth.tolist());worst=diagnostic['worst_edges'][0]
  for col,sign in enumerate([1,-1]):
   triangles=np.concatenate([body[bodyfaces],cloth[faces]])
   colors=np.concatenate([np.tile([[.75,.78,.80,1]],(len(bodyfaces),1)),cmap(norm(strain))])
   order=np.argsort(sign*triangles[:,:,2].mean(axis=1),kind='stable');projected=triangles[:,:,:2].copy();projected[:,:,0]*=sign
   ax=axes[row,col];ax.add_collection(PolyCollection(projected[order],facecolors=colors[order],edgecolors='none',rasterized=True))
   # Marking denotes an edge/triangle projection; it may lie behind the surface.
   selected=faces[int(np.argmax(strain))].tolist() if a.metric=='principal' else worst['vertices']
   if a.metric=='principal':selected=selected+[selected[0]]
   points=cloth[selected];ax.plot(sign*points[:,0],points[:,1],color='#20d6cb',linewidth=2,marker='o',markersize=3)
   ax.set(xlim=(-.44,.44),ylim=(-.04,1.06),aspect='equal',title=f'{name} · {"front" if sign==1 else "back"} · peak {100*(float(strain.max()) if a.metric=='principal' else worst["absolute_strain"]):.2f}%',xlabel='x (m)')
   if col==0:ax.set_ylabel('y (m)')
   ax.set_facecolor('#f8fafc');ax.spines[['top','right']].set_visible(False)
metric_label='principal strain' if a.metric=='principal' else 'intrinsic-edge strain'
fig.suptitle(f'Native construction: absolute {metric_label} at saved t={a.frame/60:g}s',fontsize=14)
fig.subplots_adjust(top=.92,bottom=.12,right=.84,hspace=.28)
bar=fig.colorbar(ScalarMappable(norm=norm,cmap=cmap),cax=fig.add_axes([.87,.2,.025,.6]));bar.set_label('Largest absolute '+('principal' if a.metric=='principal' else 'edge')+' strain per triangle')
if a.metric=='principal':bar.set_ticks([0,.1,.2,.3,.4,.45],labels=['0%','10%','20%','30%','40%','45%'])
else:bar.set_ticks([0,.05,.1,.2,.3,.35],labels=['0%','5%','10%','20%','30%','35%'])
caption='Exact saved geometry; shared 0–45% scale. Cyan marks the projected worst triangle (may be occluded).' if a.metric=='principal' else 'Exact saved geometry; shared 0–35% scale. Cyan marks the projected worst edge (may be occluded).'
fig.text(.5,.035,caption+'\nNearest-depth triangle ordering is illustrative. Normalized material response is not calibrated fabric or fit.\nA low-motion endpoint and closed seams do not imply low strain or acceptable construction.',ha='center',fontsize=9)
fig.savefig(a.out,dpi=140);plt.close(fig)
