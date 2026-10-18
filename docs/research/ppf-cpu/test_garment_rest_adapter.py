import gzip
import json
import math
from pathlib import Path
import unittest
from garment_rest_adapter import build_mapping


def captured():
    return json.loads(gzip.decompress(Path(__file__).with_name('results').joinpath('garment-first.json.gz').read_bytes()))


class GarmentRestAdapter(unittest.TestCase):
    def test_cut_rib_mapping_preserves_every_valid_ordered_render_face_and_structural_rest_length(self):
        envelope=captured();p=envelope['packet'];candidate=build_mapping(envelope)
        self.assertIsNotNone(candidate,'actual rest mapping')
        self.assertEqual(candidate['status'],'candidate_rest_mapping_only')
        self.assertFalse(candidate['native_solver_executed'])
        self.assertEqual(len(candidate['faces']),4480)
        self.assertEqual(len(candidate['skipped_render_faces']),4)
        self.assertEqual(len(candidate['initial_positions_m']),2353)
        self.assertEqual(len(candidate['sew_pairs']),22)
        edges={tuple(sorted(c['particles'])):c['rest_m'] for c in p['constraints'] if c['kind']=='structural'}
        seen=set();max_error=0
        for face in candidate['faces']:
            part=next(x for x in p['parts'] if x['part']==face['part'])
            source=part['triangles'][face['render_triangle']*3:face['render_triangle']*3+3]
            authored=[part['particles'][i] for i in source]
            native=face['vertices']
            self.assertEqual([candidate['source_particles'][i] for i in native],authored)
            self.assertEqual(face['authored_uv_m'],[part['authored_uv_m'][2*i:2*i+2] for i in source])
            for k in range(3):
                edge=tuple(sorted((authored[k],authored[(k+1)%3])));seen.add(edge)
                length=math.dist(candidate['rest_positions_m'][native[k]],candidate['rest_positions_m'][native[(k+1)%3]])
                max_error=max(max_error,abs(length-edges[edge]))
        self.assertEqual(seen,set(edges))
        self.assertLess(max_error,2e-6)
        self.assertLess(candidate['maximum_structural_rest_error_m'],2e-6)
        self.assertGreater(max_error,0,'Float32 rest rounding is measured honestly')
    def test_sewing_quotient_recovers_original_welds_and_initial_pose_without_adding_unrelated_joins(self):
        p=captured()['packet'];candidate=build_mapping(captured());self.assertIsNotNone(candidate)
        count=len(candidate['source_particles']);parent=list(range(count))
        def root(i):
            while parent[i]!=i:i=parent[i]
            return i
        for a,b in candidate['sew_pairs']:
            self.assertEqual(candidate['source_particles'][a],candidate['source_particles'][b])
            self.assertEqual(candidate['initial_positions_m'][a],candidate['initial_positions_m'][b])
            parent[root(a)]=root(b)
        classes={}
        for i,source in enumerate(candidate['source_particles']):
            classes.setdefault(source,set()).add(root(i))
            self.assertEqual(candidate['initial_positions_m'][i],p['positions_m'][source*3:source*3+3])
        self.assertEqual(len(classes),2331)
        self.assertTrue(all(len(roots)==1 for roots in classes.values()),'all original welded memberships restored')
        self.assertEqual(candidate['native_abi_encoded'],False)
        self.assertEqual(candidate['seam_bending_admitted'],False)
        self.assertEqual(candidate['body_contact_admitted'],False)
    def test_stable_owned_mapping_has_no_covert_coefficient_or_body_substitution(self):
        a=build_mapping(captured());b=build_mapping(captured());self.assertIsNotNone(a)
        self.assertEqual(a,b)
        self.assertIsNone(a['normalized_material_parameters'])
        self.assertEqual(a['body'],captured()['packet']['body'])
        a['rest_positions_m'][0][0]=123
        self.assertNotEqual(a,b)
if __name__=='__main__':unittest.main()
