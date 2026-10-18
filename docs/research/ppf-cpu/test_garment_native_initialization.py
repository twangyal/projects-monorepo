import copy
import math
from pathlib import Path
import unittest
from garment_native_inputs import load_inputs
from garment_native_initialization import separate_rib

class GarmentInitialization(unittest.TestCase):
    def test_only_rib_initial_pose_changes_while_all_rest_material_topology_inputs_are_preserved(self):
        source=load_inputs(Path(__file__).with_name('results'));saved=copy.deepcopy(source)
        result=separate_rib(source);self.assertEqual(source,saved)
        self.assertNotEqual(result['initial'],source['initial'])
        for key in source:
            if key!='initial':self.assertEqual(result[key],source[key],key)
        rib={i for f,s in zip(source['faces'],source['face_source']) if s['part']=='neckband' for i in f}
        moved=[]
        for i,(before,after) in enumerate(zip(source['initial'],result['initial'])):
            d=math.dist(before,after)
            if i in rib:self.assertGreater(d,.002);self.assertLess(d,.01);moved.append(i)
            else:self.assertEqual(before,after)
        self.assertEqual(len(moved),42)
        for stitch in result['stitch_indices']:self.assertGreater(math.dist(result['initial'][stitch[0]],result['initial'][stitch[3]]),.0015)
        self.assertEqual(result,separate_rib(source))
if __name__=='__main__':unittest.main()
