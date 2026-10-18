import copy,gzip,json,unittest,zipfile
from pathlib import Path
from garment_native_inputs import load_inputs
from garment_native_refusal import audit

class NativeRefusal(unittest.TestCase):
    def test_retained_strict_refusal_replays(self):
        result=audit(Path(__file__).with_name('results')/'garment-strict-first.zip')
        self.assertEqual(result['intersection_parts'],{'front/neckband':14,'back/neckband':11,'neckband/neckband':1})
        self.assertEqual(result['reported_proximity_pairs'],265)
        self.assertEqual(result['sampled_proximity_pairs'],100)
        self.assertEqual(result['native_frames'],0)
    def test_tampered_receipt_blueprint_and_output_are_refused(self):
        path=Path(__file__).with_name('results')/'garment-strict-first.zip'
        with zipfile.ZipFile(path) as z:original={n:z.read(n) for n in z.namelist()}
        for mode in ['receipt','blueprint','frame']:
            files=copy.copy(original)
            if mode=='receipt':
                r=json.loads(files['receipt.json']);r['cases']={'soft':{'frames':19}};files['receipt.json']=json.dumps(r).encode()
            if mode=='blueprint':
                b=json.loads(gzip.decompress(files['native-blueprint.json.gz']));b['initial'][0][0]+=1;files['native-blueprint.json.gz']=gzip.compress(json.dumps(b).encode())
            if mode=='frame':files['native-cache/output/vert_0.bin']=b'fake'
            import io
            stream=io.BytesIO()
            with zipfile.ZipFile(stream,'w') as z:
                for n,v in files.items():z.writestr(n,v)
            stream.seek(0)
            with self.subTest(mode=mode),self.assertRaises(ValueError):audit(stream,verify_archive_hash=False)

class InitializedRefusal(unittest.TestCase):
    def test_retained_initialized_refusal_replays(self):
        from garment_native_refusal import audit_initialized
        r=audit_initialized(Path(__file__).with_name('results')/'garment-initialized-first.zip')
        self.assertEqual(r['initialized']['intersection_parts'],{'front/neckband':13,'back/neckband':6})
        self.assertEqual(r['initialized']['proximity_parts'],{'front/neckband':7})
        self.assertEqual(r['padding_only']['reported_proximity_pairs'],173)
        self.assertEqual(r['padding_only']['sampled_proximity_pairs'],100)
        self.assertEqual(r['native_frames'],0)
    def test_changed_initialization_and_control_cannot_masquerade_as_evidence(self):
        from garment_native_refusal import audit_initialized
        import io
        path=Path(__file__).with_name('results')/'garment-initialized-first.zip'
        with zipfile.ZipFile(path) as z:original={n:z.read(n) for n in z.namelist()}
        for mode in ['blueprint','control','output']:
            files=original.copy()
            if mode=='blueprint':files['native-blueprint.json.gz']=files['native-blueprint-original.json.gz']
            if mode=='control':
                r=json.loads(files['receipt.json']);r['padding_only_admission']['status']='passed_scene_build';files['receipt.json']=json.dumps(r).encode()
            if mode=='output':files['native-cache/sessions/cpu-garment-soft/session/output/vert_0.bin']=b'fake'
            stream=io.BytesIO()
            with zipfile.ZipFile(stream,'w') as z:
                for n,v in files.items():z.writestr(n,v)
            stream.seek(0)
            with self.subTest(mode=mode),self.assertRaises(ValueError):audit_initialized(stream,verify_archive_hash=False)
