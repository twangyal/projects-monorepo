import io,lzma,unittest
from garment_archive_storage import read_archive
class ArchiveStorage(unittest.TestCase):
 def test_plain_and_lossless_wrapped_bytes_are_identical(self):
  original=b'PK\x03\x04unchanged official archive bytes\x00\xff'
  self.assertEqual(read_archive(io.BytesIO(original)),original)
  self.assertEqual(read_archive(io.BytesIO(lzma.compress(original))),original)
 def test_corrupt_or_truncated_wrapper_is_refused(self):
  original=lzma.compress(b'official archive')
  for changed in [original[:12],original[:-4],original[:30]+b'corrupt'+original[30:]]:
   with self.subTest(changed=changed),self.assertRaises(ValueError):read_archive(io.BytesIO(changed))
