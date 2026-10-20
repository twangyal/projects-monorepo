import copy,math,unittest
from garment_junctions import junction_audit

class JunctionAudit(unittest.TestCase):
 def disk(self):
  return {'rest':[[0,0,0],[1,0,0],[0,1,0],[-1,0,0],[0,-1,0]],'faces':[[0,1,2],[0,2,3],[0,3,4],[0,4,1]],'face_source':[{'part':p,'render_triangle':i} for i,p in enumerate(['front','front','back','back'])]}
 def test_flat_disk_center_and_boundary_have_distinct_angle_budgets(self):
  report=junction_audit(self.disk());rows=report['vertices'];center=rows[0]
  self.assertIn('connected_components',report);self.assertEqual(report['connected_components'],1);self.assertEqual(report['boundary_loops'],1)
  self.assertEqual(report['interior_vertices'],1);self.assertEqual(report['boundary_vertices'],4)
  self.assertEqual(center['fan'],'cycle');self.assertEqual(center['link_vertices'],4)
  self.assertAlmostEqual(center['angle_sum_radians'],2*math.pi)
  self.assertAlmostEqual(center['angle_deficit_radians'],0)
  self.assertAlmostEqual(center['part_angle_radians']['front'],math.pi)
  self.assertEqual(center['incident_faces'],[0,1,2,3]);self.assertEqual(center['source_triangles'],self.disk()['face_source'])
  self.assertEqual(rows[1]['fan'],'path');self.assertAlmostEqual(rows[1]['angle_sum_radians'],math.pi/2)
  self.assertAlmostEqual(report['gauss_bonnet_radians'],2*math.pi);self.assertEqual(report['euler_characteristic'],1)
 def test_octahedron_has_sphere_budget_and_coordinate_invariance(self):
  d={'rest':[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],'faces':[[0,2,4],[2,1,4],[1,3,4],[3,0,4],[2,0,5],[1,2,5],[3,1,5],[0,3,5]]}
  d['face_source']=[{'part':'shell','render_triangle':i} for i in range(8)]
  a=junction_audit(d);self.assertEqual(a['connected_components'],1);self.assertEqual(a['boundary_loops'],0);self.assertEqual(a['boundary_vertices'],0);self.assertEqual(a['euler_characteristic'],2)
  for row in a['vertices']:self.assertAlmostEqual(row['angle_deficit_radians'],2*math.pi/3)
  self.assertAlmostEqual(a['gauss_bonnet_radians'],4*math.pi)
  transformed=copy.deepcopy(d);transformed['rest']=[[4-2*z,8+2*x,3+2*y] for x,y,z in d['rest']]
  b=junction_audit(transformed)
  self.assertEqual([v['fan'] for v in a['vertices']],[v['fan'] for v in b['vertices']])
  for x,y in zip(a['vertices'],b['vertices']):self.assertAlmostEqual(x['angle_deficit_radians'],y['angle_deficit_radians'])
 def test_disconnected_vertex_fans_refuse_even_with_manifold_edges(self):
  d=self.disk();d['rest'] += [[2,0,0],[2,1,0],[2,-1,0]]
  d['faces'] += [[0,5,6],[0,6,7],[0,7,5]];d['face_source'] += [{'part':'extra','render_triangle':i} for i in range(3)]
  with self.assertRaisesRegex(ValueError,'Disconnected vertex link'):junction_audit(d)
 def test_duplicate_nonmanifold_and_malformed_geometry_refuse(self):
  d=self.disk();bad=[]
  duplicate=copy.deepcopy(d);duplicate['faces'].append([2,1,0]);duplicate['face_source'].append({'part':'dup','render_triangle':0});bad.append(duplicate)
  nonmanifold=copy.deepcopy(d);nonmanifold['rest'].append([0,0,1]);nonmanifold['faces'].append([0,1,5]);nonmanifold['face_source'].append({'part':'extra','render_triangle':0});bad.append(nonmanifold)
  for key,value in [('rest',d['rest']+[[3,3,3]]),('rest',[[math.nan,0,0]]+d['rest'][1:]),('rest',[[0,0,0],[0,0,0]]+d['rest'][2:]),('face_source',d['face_source'][:-1]),('faces',[[0,1,1]]+d['faces'][1:]),('faces',[[0,1,99]]+d['faces'][1:])]:
   x=copy.deepcopy(d);x[key]=value;bad.append(x)
  for x in bad:
   with self.subTest(data=x):
    with self.assertRaises(ValueError):junction_audit(x)

 def test_original_authored_uv_angles_are_reported_independently(self):
  d=self.disk();d['uv']=[[[d['rest'][v][0],d['rest'][v][1]] for v in face] for face in d['faces']]
  d['uv'][0]=[[0,0],[1,0],[1,1]]
  row=junction_audit(d)['vertices'][0]
  self.assertIn('authored_angle_sum_radians',row)
  self.assertAlmostEqual(row['angle_sum_radians'],2*math.pi)
  self.assertAlmostEqual(row['authored_angle_sum_radians'],7*math.pi/4)
  self.assertAlmostEqual(row['rest_minus_authored_radians'],math.pi/4)
  self.assertAlmostEqual(row['authored_part_angle_radians']['front'],3*math.pi/4)
 def test_incomplete_nonfinite_or_degenerate_authored_uv_refuses(self):
  d=self.disk();uv=[[[d['rest'][v][0],d['rest'][v][1]] for v in face] for face in d['faces']]
  for value in [uv[:-1],[[[0,0],[1,0],[2,0]]]+uv[1:],[[[math.inf,0],[1,0],[0,1]]]+uv[1:]]:
   d['uv']=value
   with self.assertRaises(ValueError):junction_audit(d)
 def test_legitimate_saddle_star_is_not_rejected_as_a_defect(self):
  d={'rest':[[0,0,0]]+[[math.cos(i*math.pi/3),math.sin(i*math.pi/3),(-1)**i] for i in range(6)],'faces':[[0,i+1,(i+1)%6+1] for i in range(6)]}
  d['face_source']=[{'part':'saddle','render_triangle':i} for i in range(6)]
  row=junction_audit(d)['vertices'][0]
  self.assertEqual(row['fan'],'cycle');self.assertAlmostEqual(row['angle_sum_radians'],6*math.acos(-.25))
  self.assertLess(row['angle_deficit_radians'],0)
 def test_frozen_native_and_original_authored_underarm_metrics(self):
  import json
  from pathlib import Path
  from garment_junctions import study_report
  root=Path(__file__).with_name('results');actual=study_report(root/'garment-fixed-four-soft.zip')
  retained=json.loads((root/'garment-junction-audit.json').read_text())
  self.assertEqual(actual,retained)
  self.assertEqual(actual['source_archive_sha256'],'fc2c0de508864f468b7a8669de0bcf2309db3c57611c02e6e46a280476a6bf70')
  t=actual['topology'];self.assertEqual((t['vertex_count'],t['edge_count'],t['face_count']),(2353,6834,4480))
  self.assertEqual((t['interior_vertices'],t['boundary_vertices'],t['euler_characteristic']),(2125,228,-1))
  self.assertAlmostEqual(t['gauss_bonnet_radians'],-2*math.pi)
  worst=actual['most_negative_interior_junctions'][:2];self.assertEqual([r['vertex'] for r in worst],[571,643])
  for row in worst:
   self.assertEqual(row['fan'],'cycle');self.assertEqual(len(row['incident_faces']),10)
   self.assertAlmostEqual(math.degrees(row['angle_sum_radians']),627.9844798807206)
   self.assertAlmostEqual(math.degrees(row['authored_angle_sum_radians']),627.9844008355373)
   self.assertLess(abs(row['rest_minus_authored_radians']),1.4e-6)
  self.assertFalse(actual['native_solver_executed_for_this_audit'])
