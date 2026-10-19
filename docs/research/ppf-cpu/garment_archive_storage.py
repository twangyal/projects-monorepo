"""Lossless storage wrapper; official ZIP digest is verified after decompression."""
import lzma
from pathlib import Path

def read_archive(path):
 raw=path.read_bytes() if isinstance(path,Path) else path.read()
 if raw.startswith(b'\xfd7zXZ\x00'):
  try:raw=lzma.decompress(raw)
  except lzma.LZMAError as error:raise ValueError('Invalid lossless archive wrapper.') from error
 return raw
