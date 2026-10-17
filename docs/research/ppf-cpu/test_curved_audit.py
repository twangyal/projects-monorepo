import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile
from curved_geometry import sphere,sheet
from curved_metrics import body_planes,measure
from curved_audit import audit

class ArchiveReplay(unittest.TestCase):
    def archive(self,root,*,tamper=False,wrong_mapping=False,missing_native=False,wrong_native=False):
        v,f=sphere();upper,faces=sheet();planes=body_planes(v,f)
        files={};results={}
        for case,descent,curve in [('held',.025,.01),('through',.44,0)]:
            frames=[[[x,1.13-descent*k/18-curve*(x*x+z*z)/.0288*k/18,z] for x,y,z in upper] for k in range(19)]
            # Quantize before computing the receipt: actual native output is float32.
            frames=[[[struct.unpack('<f',struct.pack('<f',c))[0] for c in point] for point in frame] for frame in frames]
            results[case]=measure(frames,faces,planes)
            prefix=f'native-cache/sessions/cpu-contact-{case}/session/'
            for i,frame in enumerate(frames):files[prefix+f'output/vert_{i}.bin']=struct.pack('<243f',*(c for p in frame for c in p))
            for name in ['stdout.log','error.log']:files[prefix+name]=b'synthetic audit test\n'
            if not missing_native:
                body=[p[:] for p in v]
                if wrong_native:body[0][0]+=.001
                buffers={'static_vert.bin':('d',[c for p in body for c in p]),'static_tri.bin':('Q',[i for tri in f for i in tri]),'static_vert_dmap.bin':('I',[0]*114),'displacement.bin':('d',[0.]*6),'vert.bin':('d',[c for p in upper for c in p]),'vert_dmap.bin':('I',[1]*81),'tri.bin':('Q',[i for tri in faces for i in tri])}
                for name,(code,values) in buffers.items():files[prefix+'bin/'+name]=struct.pack('<'+str(len(values))+code,*values)

            mapping=list(range(81))
            if wrong_mapping:mapping[0]=mapping[1]
            files[case+'-geometry.json']=json.dumps({'static_vertices':v,'static_triangles':f,'cloth_triangles':faces,'solved_rest_indices':mapping}).encode()
        manifest=[{'path':p,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()} for p,b in files.items() if p.startswith('native-cache/')]
        receipt={'upstream_revision':'6b30976f86e6b94d68d459e5237d59704c7d1384','status':'passed_curved_fixture','fixture_exit_code':0,'fixture_step_outcome':'success','held':results['held'],'contact_disabled':results['through'],'retained_native_files':manifest}
        files['upstream-revision.txt']=b'6b30976f86e6b94d68d459e5237d59704c7d1384\n'
        for key,name in [('fixture_sha256','curved_probe.py'),('oracle_sha256','curved_metrics.py'),('geometry_sha256','curved_geometry.py')]:receipt[key]=hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
        if tamper:files[manifest[0]['path']]+=b'x'
        files['receipt.json']=json.dumps(receipt).encode();files['supervisor.json']=json.dumps({'exit_code':0,'remaining_children':0}).encode()
        path=root/'test.zip'
        with zipfile.ZipFile(path,'w') as z:
            for p,b in files.items():z.writestr(p,b)
        return path,hashlib.sha256(path.read_bytes()).hexdigest()
    def test_recomputes_complete_raw_archive_without_trusting_receipt_metrics(self):
        with tempfile.TemporaryDirectory() as directory:
            path,digest=self.archive(Path(directory));result=audit(path,digest)
            self.assertEqual(result['raw_frames'],38);self.assertEqual(result['finite_float32_coordinates'],9234)
            self.assertEqual(result['recomputed']['held']['penetrating_triangle_frames'],0)
            with self.assertRaises(ValueError):audit(path,'0'*64)
    def test_refuses_archives_with_no_native_scene_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            path,digest=self.archive(Path(directory),missing_native=True)
            with self.assertRaises(ValueError):audit(path,digest)
    def test_refuses_mutated_native_bytes_and_nonbijective_rest_mapping(self):
        for options in [{'tamper':True},{'wrong_mapping':True},{'wrong_native':True}]:
            with self.subTest(options),tempfile.TemporaryDirectory() as directory:
                path,digest=self.archive(Path(directory),**options)
                with self.assertRaises(ValueError):audit(path,digest)
if __name__=='__main__':unittest.main()
