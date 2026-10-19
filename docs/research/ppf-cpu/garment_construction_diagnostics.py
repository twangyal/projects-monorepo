"""Locate saved-frame strain and seam gaps on native construction provenance.

Unique global edges count once. A shared edge belongs to every incident part;
per-part counts therefore overlap. Percentiles use nearest-rank, unweighted
absolute edge strain. These diagnostics are not physical acceptance thresholds.
"""
import math
from garment_admission import require


def construction_diagnostics(inputs,frame):
 count=len(inputs['initial']);rest=inputs['rest'];faces=inputs['faces'];sources=inputs['face_source']
 require(count>0 and len(rest)==count and len(frame)==count,'Incomplete construction vertices.')
 for points in [rest,frame]:
  require(all(len(p)==3 and all(type(v) in [int,float] and math.isfinite(v) for v in p) for p in points),'Nonfinite construction coordinates.')
 require(len(faces)==len(sources) and len(faces)>0,'Missing construction provenance.')
 edges={};vertex_sources=[set() for _ in range(count)]
 for face,source in zip(faces,sources):
  require(len(face)==3 and len(set(face))==3 and all(type(v) is int and 0<=v<count for v in face),'Invalid construction triangle.')
  require(isinstance(source.get('part'),str) and source['part'] and type(source.get('render_triangle')) is int and source['render_triangle']>=0,'Invalid construction source.')
  for v in face:vertex_sources[v].add((source['part'],source['render_triangle']))
  for i in range(3):
   edge=tuple(sorted((face[i],face[(i+1)%3])))
   edges.setdefault(edge,set()).add((source['part'],source['render_triangle']))
 rows=[];parts={}
 for (a,b),source in sorted(edges.items()):
  length=math.dist(rest[a],rest[b]);require(length>1e-12,'Degenerate intrinsic edge.')
  solved=math.dist(frame[a],frame[b]);strain=solved/length-1.
  row={'vertices':[a,b],'parts':sorted({p for p,t in source}),'source_triangles':[{'part':p,'render_triangle':t} for p,t in sorted(source)],'rest_length_m':length,'solved_length_m':solved,'signed_strain':strain,'absolute_strain':abs(strain)}
  rows.append(row)
  for part in row['parts']:parts.setdefault(part,[]).append(strain)
 def distribution(values):
  absolute=sorted(abs(v) for v in values);n=len(values)
  return {'edge_count':n,'maximum_extension':max(0.,max(values)),'maximum_compression':max(0.,-min(values)),'maximum_absolute_strain':absolute[-1],'absolute_strain_p50':absolute[math.ceil(.5*n)-1],'absolute_strain_p95':absolute[math.ceil(.95*n)-1]}
 stitches=[]
 for index,stitch in enumerate(inputs['stitch_indices']):
  require(len(stitch)==6 and all(type(v) is int and 0<=v<count for v in stitch),'Invalid construction stitch.')
  require(stitch[:3]==[stitch[0]]*3 and stitch[3:]==[stitch[3]]*3,'Only captured vertex-pair stitch diagnostics are supported.')
  endpoints=[stitch[0],stitch[3]];source=set().union(*(vertex_sources[v] for v in endpoints))
  stitches.append({'stitch_row':index,'vertices':endpoints,'parts':sorted({part for part,t in source}),'endpoint_parts':[sorted({part for part,t in vertex_sources[v]}) for v in endpoints],'source_triangles':[{'part':part,'render_triangle':t} for part,t in sorted(source)],'gap_m':math.dist(frame[endpoints[0]],frame[endpoints[1]])})
 ordered=sorted(rows,key=lambda row:(-row['absolute_strain'],row['vertices']))
 return {'unique_intrinsic_edges':len(rows),'overall':distribution([row['signed_strain'] for row in rows]),'parts':{part:distribution(values) for part,values in sorted(parts.items())},'worst_edges':ordered[:10],'stitches':{'rows':len(stitches),'maximum_gap_m':max((row['gap_m'] for row in stitches),default=0.),'parts':{part:{'stitch_rows':sum(part in row['parts'] for row in stitches),'maximum_gap_m':max((row['gap_m'] for row in stitches if part in row['parts']),default=0.)} for part in sorted(parts)},'largest_gaps':sorted(stitches,key=lambda row:(-row['gap_m'],row['stitch_row']))[:10]},'scope':'One saved frame; nearest-rank unweighted edge percentiles. Shared edges appear in all incident parts. No strain tolerance, seam-quality, settling, continuous-contact, calibrated material or physical-fit acceptance.'}

if __name__=='__main__':
 import argparse,gzip,io,json,struct,zipfile
 from pathlib import Path
 from garment_archive_storage import read_archive
 from garment_material_cohort_audit import audit
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('archive',type=Path);p.add_argument('out',type=Path)
 p.add_argument('--duration-profile',choices=['four'],required=True,help='The retained complete serial-pair profile; partial pairs are not promoted.')
 args=p.parse_args();verified=audit(args.archive,profile=args.duration_profile,observation='three-second')
 with zipfile.ZipFile(io.BytesIO(read_archive(args.archive))) as z:
  inputs=json.loads(gzip.decompress(z.read('native-blueprint.json.gz')));cases={}
  for name in ['soft','stiff']:
   values=struct.unpack('<7059f',z.read(f'native-cache/sessions/cpu-garment-{name}/session/output/vert_180.bin'))
   frame=[list(values[i:i+3]) for i in range(0,len(values),3)]
   cases[name]=construction_diagnostics(inputs,frame)
   require(cases[name]['overall']['maximum_absolute_strain']==verified['cases'][name]['metrics']['final_maximum_absolute_edge_strain'],'Construction/trajectory diagnostic disagreement.')
 result={'source_archive_sha256':verified['archive_sha256'],'source_artifact_id':verified['artifact_id'],'run_url':verified['run_url'],'frame':180,'saved_time_seconds':3.,'cases':cases,'scope':'Source-located construction diagnostics from the already complete requested-four serial pair. No new native run, physical tolerance, causal construction diagnosis or fit acceptance.'}
 args.out.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
