import copy,hashlib,io,json,unittest,zipfile
from pathlib import Path
from garment_inertia_audit import audit

ARCHIVE=Path(__file__).with_name('results')/'garment-inertia-native.zip'
class InertiaAudit(unittest.TestCase):
    def test_literal_density_native_result_is_not_matched_inertia_evidence(self):
        with self.assertRaisesRegex(ValueError,'Changed detached sewing blueprint'):
            audit(ARCHIVE.with_name('garment-sewing-native.zip'),verify_archive_hash=False)

    def test_complete_actual_native_result_replays(self):
        r=audit(ARCHIVE)
        self.assertEqual((r['raw_frames'],r['native_files_verified']),(38,278))
        self.assertEqual(r['only_changed_native_bin'],['param/tri-young-mod.bin'])
        self.assertGreater(r['final_vertex_rms_difference_m'],1e-6)
        self.assertGreater(r['recomputed']['soft']['initial_maximum_stitch_gap_m'],.05)
        self.assertAlmostEqual(r.get('reported_native_mass_diagnostic_kg',0.),.15158243,places=8)
        self.assertLess(abs(r['native_mass_reductions']['soft']['accurate_face_mass_kg']/r['captured_browser_cloth_mass_kg']-1),1e-5)
        self.assertAlmostEqual(r['native_mass_reductions']['soft']['ordered_float32_diagnostic_mass_kg'],r['reported_native_mass_diagnostic_kg'],places=7)
    def test_incomplete_frames_modified_rest_extra_control_and_false_success_refuse(self):
        with zipfile.ZipFile(ARCHIVE) as z:original={n:z.read(n) for n in z.namelist() if not n.endswith('/')}
        for mode in ['frame','rest','control','status','mass','density','mapping','timing']:
            files=original.copy();r=json.loads(files['receipt.json']);prefix='native-cache/sessions/cpu-garment-soft/session/'
            if mode=='frame':del files[prefix+'output/vert_5.bin']
            if mode=='rest':files[prefix+'bin/rest_vert.bin']=bytes(len(files[prefix+'bin/rest_vert.bin']))
            if mode=='control':files[prefix+'bin/invented.bin']=b'changed'
            if mode=='status':r['status']='failed_garment_admission'
            if mode=='mass':files[prefix+'output/data/total_mass.out']=b'0 0.1978686 0\n'
            if mode=='density':files[prefix+'bin/param/tri-density.bin']=bytes(len(files[prefix+'bin/param/tri-density.bin']))
            if mode=='mapping':r['mass_parameters']['maximum_source_particle_mass_relative_error']=0.
            if mode=='timing':files[prefix+'output/data/frame_to_time.out']=b'0 0\n'
            # Re-sign the manifest to test semantic input/frame checks, not just byte hashing.
            r['retained_native_files']=[{'path':n,'bytes':len(v),'sha256':hashlib.sha256(v).hexdigest()} for n,v in files.items() if n.startswith('native-cache/')]
            files['receipt.json']=json.dumps(r).encode();stream=io.BytesIO()
            with zipfile.ZipFile(stream,'w') as z:
                for n,v in files.items():z.writestr(n,v)
            stream.seek(0)
            with self.subTest(mode=mode),self.assertRaises(ValueError):audit(stream,verify_archive_hash=False)

class NativeFrameTiming(unittest.TestCase):
    def test_exact_saved_times_and_indices_are_required(self):
        from garment_inertia_audit import verify_frame_times
        valid='\n'.join(f'{i} {i/60}' for i in range(19)).encode()
        self.assertEqual(verify_frame_times(valid),.3)
        for altered in [valid.replace(b'18 0.3',b'18 0.4'),valid.replace(b'18 0.3',b'17 0.3'),valid.replace(b'18 0.3',b'18 nan'),valid+b'\n19 0.3',b'\n'.join(valid.splitlines()[:-1])]:
            with self.subTest(altered=altered[-30:]),self.assertRaises(ValueError):verify_frame_times(altered)
