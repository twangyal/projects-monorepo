import copy,hashlib,io,json,unittest,zipfile
from pathlib import Path
from garment_sewing_audit import audit

ARCHIVE=Path(__file__).with_name('results')/'garment-sewing-native.zip'
class SewingAudit(unittest.TestCase):
    def test_complete_actual_native_result_replays(self):
        r=audit(ARCHIVE)
        self.assertEqual((r['raw_frames'],r['native_files_verified']),(38,278))
        self.assertEqual(r['only_changed_native_bin'],['param/tri-young-mod.bin'])
        self.assertGreater(r['final_vertex_rms_difference_m'],.01)
        self.assertLess(r['recomputed']['soft']['final_maximum_stitch_gap_m'],.002)
        self.assertAlmostEqual(r.get('native_total_cloth_mass_kg',0.),.1978686)
        self.assertGreater(r.get('native_vs_browser_mass_difference_percent',0.),30.)
    def test_incomplete_frames_modified_rest_extra_control_and_false_success_refuse(self):
        with zipfile.ZipFile(ARCHIVE) as z:original={n:z.read(n) for n in z.namelist() if not n.endswith('/')}
        for mode in ['frame','rest','control','status','mass']:
            files=original.copy();r=json.loads(files['receipt.json']);prefix='native-cache/sessions/cpu-garment-soft/session/'
            if mode=='frame':del files[prefix+'output/vert_5.bin']
            if mode=='rest':files[prefix+'bin/rest_vert.bin']=bytes(len(files[prefix+'bin/rest_vert.bin']))
            if mode=='control':files[prefix+'bin/invented.bin']=b'changed'
            if mode=='status':r['status']='failed_garment_admission'
            if mode=='mass':files[prefix+'output/data/total_mass.out']=b'0 0.15 0\n'
            # Re-sign the manifest to test semantic input/frame checks, not just byte hashing.
            r['retained_native_files']=[{'path':n,'bytes':len(v),'sha256':hashlib.sha256(v).hexdigest()} for n,v in files.items() if n.startswith('native-cache/')]
            files['receipt.json']=json.dumps(r).encode();stream=io.BytesIO()
            with zipfile.ZipFile(stream,'w') as z:
                for n,v in files.items():z.writestr(n,v)
            stream.seek(0)
            with self.subTest(mode=mode),self.assertRaises(ValueError):audit(stream,verify_archive_hash=False)
