"""Independent checks; SciPy is review-only, not a production dependency."""
import hashlib
import json
from pathlib import Path
import numpy as np
import PIL
from PIL import Image
import scipy
from scipy.ndimage import label

root=Path('/workspace/scratch/dea0b0842cca/projects-monorepo')
base=root/'docs/research/lens-depth-baseline/boundary-2026-10-10'
p=Path('/tmp/lens-boundary-primary')
r=Path('/tmp/lens-boundary-review')
a=json.loads((base/'source-annotation.json').read_text())
ref=np.asarray(Image.open(r/'reference.png'))>0
h,w=ref.shape
rng=np.random.default_rng(20261010)
coords=list(zip(rng.integers(0,w,2000),rng.integers(0,h,2000)))
for xx,yy in a['polygons'][0]['outer']:
    x,y=int(xx*w),int(yy*h)
    coords.extend((x+dx,y+dy) for dx in (-1,0,1) for dy in (-1,0,1) if 0<=x+dx<w and 0<=y+dy<h)
def inside(x,y,poly):
    n=0
    last=poly[-1]
    for cur in poly:
        x1,y1=last; x2,y2=cur
        if min(y1,y2)<=y<max(y1,y2):
            ix=(x2-x1)*(y-y1)/(y2-y1)+x1
            if ix>x: n+=1
        last=cur
    return n%2==1
for x,y in coords:
    val=any(inside((x+.5)/w,(y+.5)/h,q['outer']) for q in a['polygons'])
    val=val and not any(inside((x+.5)/w,(y+.5)/h,q) for q in a['background_holes'])
    assert ref[y,x]==val,(x,y)
res=json.loads((r/'result.json').read_text())
assert res==json.loads((p/'result.json').read_text())
depth=np.asarray(Image.open(root/'docs/research/lens-depth-baseline/extension-2026-10-10/portrait-result.png'))
assert int(depth[238,392])==129
band=(depth>=109)&(depth<=149)
assert np.array_equal(band,np.asarray(Image.open(r/'whole-band.png'))>0)
labels,count=label(band,structure=np.array([[0,1,0],[1,1,1],[0,1,0]]))
anch=np.asarray(Image.open(r/'anchor-component.png'))>0
assert np.array_equal(anch,labels==labels[238,392])
hashes={}
for name in ('reference',*res['comparisons']):
    q=r/(name+'.png'); orig=p/(name+'.png')
    hashes[name]=hashlib.sha256(q.read_bytes()).hexdigest()
    assert hashes[name]==hashlib.sha256(orig.read_bytes()).hexdigest()
    mask=np.asarray(Image.open(q))>0
    assert np.array_equal(mask,np.asarray(Image.open(orig))>0)
    if name!='reference':
        tn,fp,fn,tp=np.bincount(2*ref.ravel().astype(int)+mask.ravel(),minlength=4)
        actual=res['comparisons'][name]
        assert [int(tp),int(fp),int(fn),int(tn)]==[actual[k] for k in ('truePositive','falsePositive','falseNegative','trueNegative')]
        assert actual['differentPixels']==int(fp+fn)
        assert actual['differentFraction']==int(fp+fn)/ref.size
        assert actual['iou']==int(tp)/int(tp+fp+fn)
report={'reviewer':'/root/review_lens_boundary','versions':{'numpy':np.__version__,'pillow':PIL.__version__,'scipyReviewOnly':scipy.__version__},'frozenProtocolSha256':hashlib.sha256((base/'frozen-protocol.json').read_bytes()).hexdigest(),'frozenAnnotationSha256':hashlib.sha256((base/'source-annotation.json').read_bytes()).hexdigest(),'scalarPixelCenterChecks':{'checked':len(coords),'matched':len(coords),'randomSeed':20261010,'randomSamples':2000,'additionalSamples':'3x3 neighbourhoods around all outer vertices, clipped to raster; duplicates retained'},'fourConnectedScipyLabelMatchesEveryPixel':True,'independentFrozenDepthBandMatchesEveryPixel':True,'independentConfusionCountsAndAllMetricsMatch':True,'freshProcessReceiptMatchesPrimary':True,'freshProcessAllRawMasksMatchPrimary':True,'freshProcessMaskPngSha256':hashes,'sourceReferenceVisualPlausibility':'Coarse source-only silhouette plausibly includes arms, hair, dress, visible legs/shoes. Thin boundary uncertainties remain. Anchored mask leaks into floor/railing/right doorway.','reviewFinding':'No important or critical blockers found in bounded offline diagnostic or stated README claims.','negativeCheck':{'wrongInput':'repo smoke-depth.png supplied where frozen portrait-result.png required','exitCode':1,'log':'/tmp/lens-boundary-review-negative.log','description':'Wrong existing image; not modified bytes. Checksum mismatch rejected before output creation.'},'limitations':['Single coarse source-only annotator; not professionally measured GT','Already-used photo; not held out','Binary pixel flips are synthetic burden proxy, not human effort/time or product readiness','SciPy used only for independent review'], 'verifierSource':'/tmp/lens-boundary-review-verify.py'}
Path('/tmp/lens-boundary-review-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
