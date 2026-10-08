import unittest


class LimitsTests(unittest.TestCase):
    def test_full_song_resource_contract(self):
        from karaoke import limits
        self.assertEqual((limits.MIN_DURATION, limits.MAX_DURATION, limits.SAMPLE_RATE), (1, 300, 44100))
        self.assertEqual(limits.MAX_INPUT_BYTES, 64 * 1024**2)
        self.assertEqual(limits.MAX_DECODE_BYTES, 105840000)
        self.assertEqual(limits.MAX_WAV_BYTES, 52920000 + 4096)
        self.assertEqual((limits.WINDOW_FRAMES, limits.OVERLAP_FRAMES, limits.HOP_FRAMES, limits.MAX_WINDOWS),
                         (1323000, 88200, 1234800, 11))
        self.assertEqual((limits.MAX_CUES, limits.MAX_LYRIC_CHARS, limits.MAX_JSON_BYTES), (200, 20000, 262144))
        self.assertGreaterEqual(limits.WORKER_FILE_BYTES, limits.MAX_DECODE_BYTES)
        self.assertLess(limits.MAX_JOB_SCRATCH_BYTES, limits.MIN_FREE_BYTES)

    def test_conservative_scratch_accounting_stays_under_budget(self):
        from karaoke import limits
        # Include even decoded scratch although production removes it before inference.
        maximum = (limits.MAX_INPUT_BYTES + 3 * limits.MAX_DECODE_BYTES
                   + 6 * limits.MAX_WAV_BYTES + limits.MAX_JSON_BYTES + 16384)
        self.assertLess(maximum, limits.MAX_JOB_SCRATCH_BYTES)
        self.assertLess(limits.MAX_CARD_BYTES + limits.MAX_VIDEO_BYTES, limits.MAX_JOB_SCRATCH_BYTES)
