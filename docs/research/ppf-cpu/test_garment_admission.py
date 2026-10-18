import gzip
import json
import math
from pathlib import Path
import unittest
from garment_admission import audit,triangle_area,compare_edge


def packet():
    return json.loads(gzip.decompress(Path(__file__).with_name('results').joinpath('garment-first.json.gz').read_bytes()))


class GarmentAdmission(unittest.TestCase):
    def test_actual_tee_is_captured_but_neither_naive_rest_mapping_is_admitted(self):
        result=audit(packet())
        self.assertEqual(result['status'],'blocked_native_mapping')
        self.assertEqual(result['particles'],2331)
        self.assertEqual(result['authored_triangles'],4484)
        self.assertGreater(result['direct_shell']['mismatched_edges'],1000)
        self.assertGreater(result['flattened_xy']['mismatched_edges'],0)
        self.assertGreater(result['parts']['neckband']['flattened_xy_max_rest_error_m'],.001)
        self.assertEqual(result['body']['initial_inside_vertex_count'],0)
        self.assertGreater(result['body']['minimum_full_body_gap_m'],0)
        self.assertFalse(result['native_solver_executed'])
        self.assertFalse(result['source_files_verified'])
    def test_intrinsic_area_uses_lengths_not_inflated_shell(self):
        self.assertAlmostEqual(triangle_area([3,4,5]),6)
        shell,flat=compare_edge([[0,0,0],[3,4,12]],[[0,0,0],[3,4,0]],5)
        self.assertEqual(shell,8);self.assertEqual(flat,0)
        for bad in [[0,1,1],[1,1,2],[1,2,4],[math.nan,1,1]]:
            with self.assertRaises(ValueError):triangle_area(bad)
    def test_packet_refuses_corrupt_geometry_units_mappings_and_rest_data(self):
        changes=[lambda p:p['positions_m'].__setitem__(0,math.nan),
                 lambda p:p['parts'][0]['particles'].__setitem__(0,999999),
                 lambda p:p['parts'][0]['triangles'].__setitem__(0,-1),
                 lambda p:p['parts'][0]['authored_uv_m'].pop(),
                 lambda p:p['constraints'][0].__setitem__('rest_m',0),
                 lambda p:p['constraints'].pop(0),
                 lambda p:p['units'].__setitem__('length','cm'),
                 lambda p:p['particle_inverse_mass_per_kg'].__setitem__(0,0),
                 lambda p:p['seam_groups'].pop(),
                 lambda p:p['parts'][0].__setitem__('areal_density_kg_m2',180),
                 lambda p:p['body']['capsules_m'][0].__setitem__('radius',-1),
                 lambda p:p.__setitem__('native_material_parameters',{'young-mod':.000008})]
        for change in changes:
            with self.subTest(change=change):
                value=packet();change(value['packet'])
                with self.assertRaises(ValueError):audit(value)
    def test_ordered_topology_and_shell_mapping_remain_cross_checked(self):
        for change in [lambda p:p['parts'][0]['shell_positions_m'].__setitem__(0,100),
                       lambda p:p['parts'][0]['triangles'].__setitem__(0,p['parts'][0]['triangles'][1]),
                       lambda p:p['constraints'][0]['particles'].__setitem__(1,99999)]:
            value=packet();change(value['packet'])
            with self.assertRaises(ValueError):audit(value)
    def test_source_verification_refuses_changed_source_bytes(self):
        value=packet();value['source_sha256']['src/product.ts']='0'*64
        root=Path(__file__).resolve().parents[3]/'apps/clothing-studio'
        with self.assertRaises(ValueError):audit(value,root)
if __name__=='__main__':unittest.main()
