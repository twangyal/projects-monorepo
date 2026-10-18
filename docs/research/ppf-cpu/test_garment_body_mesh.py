import gzip
import json
import math
from pathlib import Path
import unittest
import subprocess
import sys
import tempfile
from garment_body_mesh import mesh_body,extract_surface


def closed_mesh(vertices,faces):
    edges={};volume=0
    for a,b,c in faces:
        u,v,w=vertices[a],vertices[b],vertices[c]
        cross=[v[1]*w[2]-v[2]*w[1],v[2]*w[0]-v[0]*w[2],v[0]*w[1]-v[1]*w[0]]
        volume+=sum(u[i]*cross[i] for i in range(3))/6
        for i,j in [(a,b),(b,c),(c,a)]:
            edge=tuple(sorted((i,j)));edges.setdefault(edge,[]).append((i,j))
    assert all(len(e)==2 and e[0]==e[1][::-1] for e in edges.values()),'must be closed with consistent winding'
    assert volume>0,'outward oriented positive volume'
    return volume


class BodyMesh(unittest.TestCase):
    def test_independent_sphere_has_closed_outward_surface_and_bounded_geometric_error(self):
        mesh=extract_surface(lambda p:math.sqrt(sum(x*x for x in p))-1,[[-1.3,-1.3,-1.3],[1.31,1.31,1.31]],.2)
        self.assertIsNotNone(mesh,'actual surface')
        volume=closed_mesh(mesh['vertices_m'],mesh['triangles'])
        self.assertLess(abs(volume-4*math.pi/3),.2)
        self.assertLess(max(abs(math.sqrt(sum(x*x for x in p))-1) for p in mesh['vertices_m']),.02)
    def test_frozen_actual_body_is_closed_but_remains_an_explicitly_unadmitted_candidate(self):
        packet=json.loads(gzip.decompress(Path(__file__).with_name('results').joinpath('garment-first.json.gz').read_bytes()))
        body=packet['packet']['body'];mesh=mesh_body(body)
        self.assertIsNotNone(mesh)
        volume=closed_mesh(mesh['vertices_m'],mesh['triangles'])
        self.assertGreater(volume,.02);self.assertLess(volume,.3)
        self.assertEqual(mesh['source_body'],body)
        self.assertEqual(mesh['step_m'],.02)
        self.assertEqual(mesh['lower_cap_y_m'],-.6)
        self.assertFalse(mesh['native_solver_executed'])
        self.assertFalse(mesh['garment_triangle_contact_admitted'])
        self.assertTrue(all(all(math.isfinite(x) for x in p) for p in mesh['vertices_m']))
    def test_cli_refuses_wrong_packet_units_before_writing_a_candidate(self):
        packet=json.loads(gzip.decompress(Path(__file__).with_name('results').joinpath('garment-first.json.gz').read_bytes()))
        packet['packet']['units']['length']='cm'
        with tempfile.TemporaryDirectory() as temporary:
            source=Path(temporary)/'wrong.json.gz';output=Path(temporary)/'candidate.json.gz'
            source.write_bytes(gzip.compress(json.dumps(packet).encode()))
            run=subprocess.run([sys.executable,str(Path(__file__).with_name('garment_body_mesh.py')),str(source),str(output)],capture_output=True,text=True)
            self.assertNotEqual(run.returncode,0,'wrong-unit packet must refuse')
            self.assertFalse(output.exists(),'refusal cannot produce an apparently valid candidate')

    def test_invalid_grid_or_clipped_surface_refuses(self):
        for step in [0,-1,math.nan]:
            with self.assertRaises(ValueError):extract_surface(lambda p:math.dist(p,[0,0,0])-1,[[-2,-2,-2],[2,2,2]],step)
        with self.assertRaises(ValueError):extract_surface(lambda p:-1,[[-1,-1,-1],[1,1,1]],.5)
if __name__=='__main__':unittest.main()
