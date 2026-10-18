import copy,gzip,json,math,unittest
from pathlib import Path
from garment_native_inputs import load_inputs
from garment_sewing_layout import sewing_layout
from garment_mass import match_browser_inertia
ROOT=Path(__file__).with_name('results')

class GarmentMass(unittest.TestCase):
    def test_actual_native_triangle_masses_recover_captured_particle_masses_not_just_total(self):
        source=load_inputs(ROOT);prepared,_=sewing_layout(source);result,report=match_browser_inertia(source,prepared,ROOT)
        self.assertNotEqual(result['face_density'],prepared['face_density'])
        self.assertEqual(result['captured_face_density'],source['face_density'])
        packet=json.loads(gzip.decompress((ROOT/'garment-first.json.gz').read_bytes()))['packet']
        candidate=json.loads(gzip.decompress((ROOT/'garment-rest-candidate.json.gz').read_bytes()))
        mapping=[None]*2353
        for authored,solved in enumerate(source['authored_to_solved']):mapping[solved]=candidate['source_particles'][authored]
        masses=[0.]*2331
        for face,density in zip(result['faces'],result['face_density']):
            a,b,c=[result['initial'][i] for i in face];u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
            mass=.5*math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])*density
            for i in face:masses[mapping[i]]+=mass/3
        reference=[1/v for v in packet['particle_inverse_mass_per_kg']]
        self.assertLess(max(abs(a/b-1) for a,b in zip(masses,reference)),1e-5)
        self.assertAlmostEqual(sum(masses),sum(reference),places=7)
        self.assertLess(report['maximum_source_particle_mass_relative_error'],1e-5)
    def test_source_and_all_geometry_rest_material_provenance_are_preserved(self):
        source=load_inputs(ROOT);prepared,_=sewing_layout(source);saved=copy.deepcopy(prepared);original=copy.deepcopy(source)
        result,report=match_browser_inertia(source,prepared,ROOT)
        self.assertEqual(source,original);self.assertEqual(prepared,saved)
        for key in prepared:
            if key!='face_density':self.assertEqual(result[key],prepared[key],key)
        self.assertEqual(report.get('source_artifact_sha256'),source['source_artifact_sha256'])
    def test_changed_topology_unsupported_source_and_degenerate_initialization_refuse(self):
        source=load_inputs(ROOT);prepared,_=sewing_layout(source)
        for mode in ['face','source','degenerate']:
            s=copy.deepcopy(source);p=copy.deepcopy(prepared)
            if mode=='face':p['faces'][0]=list(reversed(p['faces'][0]))
            if mode=='source':s['face_source'][0]['part']='hood'
            if mode=='degenerate':
                for v in p['faces'][0]:p['initial'][v]=[0.,0.,0.]
            with self.subTest(mode=mode),self.assertRaises(ValueError):match_browser_inertia(s,p,ROOT)
