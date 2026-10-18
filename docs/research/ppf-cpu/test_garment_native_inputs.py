import gzip
import json
import math
from pathlib import Path
import tempfile
import unittest
from garment_native_inputs import load_inputs,shell_map,encode_stitches

ROOT=Path(__file__).with_name('results')

class NativeGarmentInputs(unittest.TestCase):
    def test_shell_indexing_matches_pinned_first_face_visit_order_even_for_coincident_vertices(self):
        self.assertEqual(shell_map(5,[[3,1,4],[4,1,0]]),[3,1,4,0,2])
        for faces in [[[0,0,1]],[[0,1,9]],[[0,1,True]]]:
            with self.assertRaises(ValueError):shell_map(3,faces)
    def test_six_wide_vertex_pairs_preserve_weight_sums_and_original_identity(self):
        self.assertEqual(encode_stitches([[0,3],[1,4]],[3,1,4,0,2]),([[3,3,3,0,0,0],[1,1,1,2,2,2]],[[1.,0.,0.,1.,0.,0.]]*2))
        for pairs in [[[0,0]],[[0,99]]]:
            with self.assertRaises(ValueError):encode_stitches(pairs,[0,1])
    def test_actual_inputs_preserve_every_triangle_uv_rest_vertex_and_body_face(self):
        data=load_inputs(ROOT);self.assertIsNotNone(data)
        self.assertEqual((len(data['initial']),len(data['faces']),len(data['stitch_indices'])),(2353,4480,22))
        self.assertEqual((len(data['body_vertices']),len(data['body_faces'])),(19574,39144))
        candidate=json.loads(gzip.decompress((ROOT/'garment-rest-candidate.json.gz').read_bytes()))
        mapping=data['authored_to_solved']
        self.assertEqual(sorted(mapping),list(range(2353)))
        for authored,solved in enumerate(mapping):
            self.assertEqual(data['initial'][solved],candidate['initial_positions_m'][authored])
            self.assertEqual(data['rest'][solved],candidate['rest_positions_m'][authored])
        self.assertEqual(data['faces'],[[mapping[v] for v in face['vertices']] for face in candidate['faces']])
        self.assertEqual(data['uv'],[f['authored_uv_m'] for f in candidate['faces']])
        self.assertTrue(all(all(math.isfinite(n) for n in v) for v in data['rest']))
    def test_changed_archive_fails_before_decoding(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            for p in ROOT.glob('garment-*.json.gz'):(root/p.name).write_bytes(p.read_bytes())
            target=root/'garment-rest-candidate.json.gz';target.write_bytes(target.read_bytes()+b'bad')
            with self.assertRaises(ValueError):load_inputs(root)
if __name__=='__main__':unittest.main()
