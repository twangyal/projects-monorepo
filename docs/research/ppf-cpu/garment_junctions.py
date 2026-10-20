"""Intrinsic corner budgets on the native welded triangle complex.

A negative angle deficit is saddle curvature, not proof of a defect. Native
finite-penalty stitches are NOT welded by this audit. No solver input is edited.
"""
import math
from collections import defaultdict
from garment_admission import require


def junction_audit(inputs):
 points=inputs.get('rest',[]);faces=inputs.get('faces',[]);sources=inputs.get('face_source',[])
 require(len(points)>0 and len(faces)>0 and len(faces)==len(sources),'Incomplete junction geometry/provenance.')
 require(all(len(p)==3 and all(type(x) in (int,float) and math.isfinite(x) for x in p) for p in points),'Nonfinite junction coordinates.')
 uv=inputs.get('uv');authored=[[] for _ in points]
 if 'uv' in inputs:require(isinstance(uv,list) and len(uv)==len(faces),'Incomplete authored UV triangles.')
 edges=defaultdict(list);incident=[[] for _ in points];corners=[[] for _ in points];seen=set()
 for index,(face,source) in enumerate(zip(faces,sources)):
  require(len(face)==3 and len(set(face))==3 and all(type(v) is int and 0<=v<len(points) for v in face),'Invalid junction triangle.')
  key=tuple(sorted(face));require(key not in seen,'Duplicate junction triangle.');seen.add(key)
  require(isinstance(source,dict) and isinstance(source.get('part'),str) and source['part'] and type(source.get('render_triangle')) is int and source['render_triangle']>=0,'Invalid junction provenance.')
  if uv is not None:require(len(uv[index])==3 and all(len(p)==2 and all(type(x) in (int,float) and math.isfinite(x) for x in p) for p in uv[index]),'Nonfinite authored UV coordinates.')
  for k,v in enumerate(face):
   a,b=face[(k+1)%3],face[(k+2)%3]
   u=[points[a][j]-points[v][j] for j in range(3)];w=[points[b][j]-points[v][j] for j in range(3)]
   cross=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]]
   area=math.hypot(*cross);dot=math.fsum(x*y for x,y in zip(u,w))
   require(math.isfinite(area) and math.isfinite(dot) and area>2e-18,'Degenerate junction triangle.')
   angle=math.atan2(area,dot)
   incident[v].append(index);corners[v].append((a,b,angle,source['part']))
   if uv is not None:
    q=uv[index];x=[q[(k+1)%3][j]-q[k][j] for j in range(2)];y=[q[(k+2)%3][j]-q[k][j] for j in range(2)]
    determinant=abs(x[0]*y[1]-x[1]*y[0]);product=math.fsum(a*b for a,b in zip(x,y))
    require(math.isfinite(determinant) and math.isfinite(product) and determinant>2e-18,'Degenerate authored UV triangle.')
    authored[v].append((source['part'],math.atan2(determinant,product)))
   edges[tuple(sorted((v,a)))].append(index)
 require(all(len(rows)<=2 for rows in edges.values()),'Nonmanifold junction edge.')
 require(all(incident),'Unused junction vertex.')
 rows=[]
 for v,fan in enumerate(corners):
  link=defaultdict(set)
  for a,b,angle,part in fan:link[a].add(b);link[b].add(a)
  reached=set();pending=[next(iter(link))]
  while pending:
   a=pending.pop()
   if a in reached:continue
   reached.add(a);pending.extend(link[a]-reached)
  require(len(reached)==len(link),'Disconnected vertex link.')
  ends=sum(len(neighbors)==1 for neighbors in link.values())
  boundary=ends==2
  require(all(len(neighbors) in (1,2) for neighbors in link.values()) and (ends==0 or boundary),'Invalid vertex link fan.')
  angles=defaultdict(list)
  for a,b,angle,part in fan:angles[part].append(angle)
  total=math.fsum(angle for a,b,angle,part in fan);budget=math.pi if boundary else 2*math.pi
  rows.append({'vertex':v,'fan':'path' if boundary else 'cycle','link_vertices':len(link),'incident_faces':incident[v],'source_triangles':[dict(sources[i]) for i in incident[v]],'angle_sum_radians':total,'angle_deficit_radians':budget-total,'part_angle_radians':{part:math.fsum(values) for part,values in sorted(angles.items())}})
 if uv is not None:
  for v,row in enumerate(rows):
   groups=defaultdict(list)
   for part,angle in authored[v]:groups[part].append(angle)
   total=math.fsum(angle for part,angle in authored[v])
   row.update({'authored_angle_sum_radians':total,'rest_minus_authored_radians':row['angle_sum_radians']-total,'authored_part_angle_radians':{part:math.fsum(values) for part,values in sorted(groups.items())}})
 adjacency=defaultdict(set);boundary_edges=defaultdict(set)
 for (a,b),incident_faces in edges.items():
  adjacency[a].add(b);adjacency[b].add(a)
  if len(incident_faces)==1:boundary_edges[a].add(b);boundary_edges[b].add(a)
 def component_count(graph):
  remaining=set(graph);count=0
  while remaining:
   count+=1;pending=[min(remaining)]
   while pending:
    vertex=pending.pop()
    if vertex not in remaining:continue
    remaining.remove(vertex);pending.extend(graph[vertex]&remaining)
  return count
 require(all(len(neighbors)==2 for neighbors in boundary_edges.values()),'Invalid boundary loop.')
 connected_components=component_count(adjacency);boundary_loops=component_count(boundary_edges)
 euler=len(points)-len(edges)+len(faces);total=math.fsum(row['angle_deficit_radians'] for row in rows)
 require(math.isclose(total,2*math.pi*euler,rel_tol=1e-10,abs_tol=1e-10),'Corner/global topology budget disagreement.')
 return {'connected_components':connected_components,'boundary_loops':boundary_loops,'vertex_count':len(points),'edge_count':len(edges),'face_count':len(faces),'boundary_vertices':sum(row['fan']=='path' for row in rows),'interior_vertices':sum(row['fan']=='cycle' for row in rows),'euler_characteristic':euler,'gauss_bonnet_radians':total,'vertices':rows,'scope':'Native welded triangle complex only; stitches remain separate. Angle deficit is intrinsic curvature, not a causal strain diagnosis, flatness requirement, construction defect, physical threshold or fit acceptance.'}


def study_report(archive):
 """Replay the admitted fixed-four-soft archive before reporting its rest fans."""
 import gzip,io,json,zipfile
 from garment_archive_storage import read_archive
 from garment_fixed_material_audit import audit
 verified=audit(archive,profile='four-soft')
 with zipfile.ZipFile(io.BytesIO(read_archive(archive))) as z:
  inputs=json.loads(gzip.decompress(z.read('native-blueprint.json.gz')))
 report=junction_audit(inputs)
 summary={key:value for key,value in report.items() if key!='vertices'}
 rows=report['vertices']
 return {'schema':'clothing-native-rest-junction-audit-v1','source_archive_sha256':verified['archive_sha256'],'source_artifact_id':verified['artifact_id'],'source_profile':'four-soft','native_solver_executed_for_this_audit':False,'topology':summary,'most_negative_interior_junctions':sorted((row for row in rows if row['fan']=='cycle'),key=lambda row:(row['angle_deficit_radians'],row['vertex']))[:10],'three_or_more_part_junctions':[row for row in rows if len(row['part_angle_radians'])>=3],'prior_strain_peak_neighborhood':[rows[v] for v in [561,571,643,1639,1640]],'scope':'Rest-only analysis of the strictly replayed unchanged archive. Authored UVs are captured styling-surface coordinates, not an assertion of exported production-pattern equivalence. No new native trajectory, causal defect, solver improvement, physical calibration or fit acceptance.'}


if __name__=='__main__':
 import argparse,json
 from pathlib import Path
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('archive',type=Path);parser.add_argument('out',type=Path)
 args=parser.parse_args()
 args.out.write_text(json.dumps(study_report(args.archive),indent=2,allow_nan=False)+'\n')
