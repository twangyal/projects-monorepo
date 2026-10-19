"""Intrinsic triangle principal engineering strain (stretch minus one).

Uses an orthonormal basis of each unchanged rest triangle and singular values
of its 3x2 affine deformation gradient. This is a saved-face geometric metric,
not constitutive stress, a physical tolerance, orientation/inversion detection,
continuous contact, convergence or fit acceptance. Standard library only.
"""
import math
from garment_admission import require


def _sub(a,b):return [x-y for x,y in zip(a,b)]
def _dot(a,b):return math.fsum(x*y for x,y in zip(a,b))
def _cross(a,b):return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]

def triangle_strain(rest,solved):
 for points in [rest,solved]:
  require(len(points)==3 and all(len(p)==3 and all(type(v) in [int,float] and math.isfinite(v) for v in p) for p in points),'Require finite 3D triangles.')
 r1=_sub(rest[1],rest[0]);r2=_sub(rest[2],rest[0]);s1=_sub(solved[1],solved[0]);s2=_sub(solved[2],solved[0])
 length=math.hypot(*r1);twice_area=math.hypot(*_cross(r1,r2))
 require(math.isfinite(length) and math.isfinite(twice_area) and length>0 and twice_area>2e-18,'Degenerate or numerically tiny rest triangle.')
 projection=_dot(r1,r2)/length;height=twice_area/length
 f0=[v/length for v in s1];f1=[(v-projection*u)/height for v,u in zip(s2,f0)]
 a,b,c=_dot(f0,f0),_dot(f0,f1),_dot(f1,f1)
 require(all(math.isfinite(v) for v in [a,b,c]),'Nonfinite deformation metric.')
 maximum_squared=(a+c+math.hypot(a-c,2*b))/2
 # det(F^T F) is |f0 cross f1|^2. Recover the smaller eigenvalue from
 # determinant/lambda_max, avoiding trace-minus-discriminant cancellation.
 area_ratio=math.hypot(*_cross(f0,f1))
 maximum=math.sqrt(maximum_squared)
 minimum=area_ratio/maximum if maximum else 0.
 require(all(math.isfinite(v) for v in [area_ratio,maximum,minimum]),'Nonfinite principal stretch.')
 extension=max(0.,maximum-1.);compression=max(0.,1.-minimum)
 return {'rest_area_m2':twice_area/2,'maximum_stretch':maximum,'minimum_stretch':minimum,'maximum_extension':extension,'maximum_compression':compression,'maximum_absolute_principal_strain':max(extension,compression),'area_ratio':area_ratio}

def principal_strain(inputs,frame):
 rest=inputs['rest'];faces=inputs['faces'];sources=inputs['face_source'];count=len(inputs['initial'])
 require(count>0 and len(rest)==len(frame)==count and len(faces)==len(sources) and len(faces)>0,'Incomplete triangle metric inputs.')
 rows=[];parts={}
 for i,(face,source) in enumerate(zip(faces,sources)):
  require(len(face)==3 and len(set(face))==3 and all(type(v) is int and 0<=v<count for v in face),'Invalid metric triangle.')
  require(isinstance(source.get('part'),str) and source['part'] and type(source.get('render_triangle')) is int and source['render_triangle']>=0,'Invalid metric provenance.')
  row={'native_triangle':i,'vertices':list(face),'source':dict(source),**triangle_strain([rest[v] for v in face],[frame[v] for v in face])}
  rows.append(row);parts.setdefault(source['part'],[]).append(row)
 def summary(group):
  total=math.fsum(row['rest_area_m2'] for row in group)
  ordered=sorted(group,key=lambda row:(row['maximum_absolute_principal_strain'],row['native_triangle']))
  def quantile(p):
   cumulative=0.
   for row in ordered:
    cumulative+=row['rest_area_m2']
    if cumulative>=p*total:return row['maximum_absolute_principal_strain']
   return ordered[-1]['maximum_absolute_principal_strain']
  return {'triangles':len(group),'rest_area_m2':total,'solved_area_m2':math.fsum(row['rest_area_m2']*row['area_ratio'] for row in group),'maximum_extension':max(row['maximum_extension'] for row in group),'maximum_compression':max(row['maximum_compression'] for row in group),'maximum_absolute_principal_strain':max(row['maximum_absolute_principal_strain'] for row in group),'rest_area_weighted_absolute_strain_p50':quantile(.5),'rest_area_weighted_absolute_strain_p95':quantile(.95),'minimum_area_ratio':min(row['area_ratio'] for row in group),'maximum_area_ratio':max(row['area_ratio'] for row in group),'zero_area_solved_triangles':sum(row['area_ratio']==0 for row in group)}
 return {'overall':summary(rows),'parts':{part:summary(group) for part,group in sorted(parts.items())},'worst_triangles':sorted(rows,key=lambda row:(-row['maximum_absolute_principal_strain'],row['native_triangle']))[:10],'scope':'Saved-face principal engineering strains are singular-value stretches minus one; absolute strain includes compression. Percentiles weight original rest area, not face count. No stress, physical tolerance, inversion, settling, contact, mesh convergence or fit acceptance.'}

if __name__=='__main__':
 import argparse,gzip,io,json,struct,zipfile
 from pathlib import Path
 from garment_archive_storage import read_archive
 from garment_fixed_material_audit import audit,PROFILES
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('archive',type=Path);p.add_argument('out',type=Path);p.add_argument('--profile',choices=list(PROFILES),required=True);args=p.parse_args()
 verified=audit(args.archive,profile=args.profile);name=verified['fixed_material']
 with zipfile.ZipFile(io.BytesIO(read_archive(args.archive))) as z:
  inputs=json.loads(gzip.decompress(z.read('native-blueprint.json.gz')))
  values=struct.unpack('<7059f',z.read(f'native-cache/sessions/cpu-garment-{name}/session/output/vert_180.bin'))
  frame=[list(values[i:i+3]) for i in range(0,len(values),3)]
 result={'source_archive_sha256':verified['archive_sha256'],'source_artifact_id':verified['artifact_id'],'profile':args.profile,'fixed_material':name,'normalized_young':verified['normalized_young'],'saved_time_seconds':3.,'edge_maximum_absolute_strain':verified['case']['metrics']['final_maximum_absolute_edge_strain'],'principal_strain':principal_strain(inputs,frame)}
 args.out.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
