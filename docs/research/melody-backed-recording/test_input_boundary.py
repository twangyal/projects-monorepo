"""Guard evidence admission against interval, numeric and byte tampering."""
import base64, gzip, hashlib, math, struct, unittest
from verify_input_boundary import input_intervals, decode_capture, zero_runs, frequency

def block(frame, runs):
    return dict(type='diagnostic-input300', currentFrame=frame, sampleRate=44100, channels=2, frames=128, zeroRuns=runs)

class EvidenceTests(unittest.TestCase):
    def test_absolute_merge_and_clip(self):
        self.assertEqual(input_intervals([block(128, [[100,128]]), block(256,[[0,80]]), block(512,[[0,128]])], 240, 600), [[0,96],[272,360]])
    def test_outside_and_empty_capture(self):
        self.assertEqual(input_intervals([block(0,[[0,128]]),block(512,[[0,128]])],128,512), [])
        with self.assertRaises(AssertionError): input_intervals([],10,10)
    def test_bad_input_metadata_refuses(self):
        for changed in ({'currentFrame':True},{'frames':127},{'sampleRate':48000},{'channels':1},{'zeroRuns':[[2,129]]},{'zeroRuns':[[3,9]]},{'zeroRuns':[[10,8]]}):
            with self.subTest(changed=changed), self.assertRaises(AssertionError): input_intervals([block(0,[[0,128]])|changed],0,256)
    def test_order_and_duplicate_refuse(self):
        for blocks in ([block(128,[[0,128]]),block(0,[[0,128]])],[block(0,[[0,128]])]*2):
            with self.assertRaises(AssertionError): input_intervals(blocks,0,256)
    def test_exact_bytes_finite_and_zeros(self):
        data=struct.pack('<12f',1,*([0]*8),-1,1,0)
        payload={'gzipBase64':base64.b64encode(gzip.compress(data,mtime=0)).decode(),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
        self.assertEqual(zero_runs(decode_capture(payload,'f')), [[1,9]])
        with self.assertRaises(AssertionError): decode_capture(payload|{'sha256':'0'*64},'f')
        with self.assertRaises(AssertionError): decode_capture(payload|{'bytes':4},'f')
    def test_nonfinite_and_trailing_compressed_data_refuse(self):
        for data,tail in [(struct.pack('<f',math.nan),b''),(struct.pack('<f',1),b'x')]:
            p={'gzipBase64':base64.b64encode(gzip.compress(data,mtime=0)+tail).decode(),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
            with self.assertRaises(AssertionError): decode_capture(p,'f')
    def test_frequency_window_does_not_hide_later_gap(self):
        pcm=[round(8192*math.sin(2*math.pi*440*i/22050)) for i in range(44100)]
        pcm[30000:30220]=[0]*220
        self.assertEqual(frequency(pcm)['hz'],440)
        self.assertEqual(zero_runs(pcm),[[30000,30220]])

if __name__=='__main__': unittest.main()
