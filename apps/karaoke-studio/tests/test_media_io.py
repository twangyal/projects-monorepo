"""Owned media directory paths survive rename in real child processes."""
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest

from karaoke.media_io import inherit_media_handles
from karaoke.pipeline import _run
from karaoke.video import _run_ffmpeg


class MediaHandleTests(unittest.TestCase):
    def test_audio_and_video_children_keep_writes_in_opened_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = root / "work"
            original.mkdir()
            fd = os.open(original, os.O_RDONLY | os.O_DIRECTORY)
            try:
                retained = root / "retained"
                original.rename(retained)
                original.mkdir()
                for kind in ("audio", "video"):
                    with self.subTest(kind=kind), inherit_media_handles(fd):
                        output = Path(f"/proc/self/fd/{fd}/{kind}.bin")
                        command = [sys.executable, "-c", "from pathlib import Path; import sys; Path(sys.argv[1]).write_bytes(b'owned')", str(output)]
                        if kind == "audio":
                            _run(command, threading.Event(), rss_limit_kib=None)
                        else:
                            _run_ffmpeg(command, threading.Event(), output)
                        self.assertEqual((retained / f"{kind}.bin").read_bytes(), b"owned")
                        self.assertFalse((original / f"{kind}.bin").exists())
            finally:
                os.close(fd)
