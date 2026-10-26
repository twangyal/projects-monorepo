import unittest

from karaoke.pipeline import MODEL_NAME, MODEL_SHA256
from karaoke.limits import MAX_WORKER_RSS_KIB
from karaoke.transcription import ENGLISH, MULTILINGUAL
from scripts.smoke_song import SOURCE_BYTES, admit_sample, check_recognition


class SongSmokeTests(unittest.TestCase):
    def processing(self):
        return dict(model=MODEL_NAME, modelSha256=MODEL_SHA256, offlineNetworkAttempts=0, peakRssKiB=1024)

    def transcript(self):
        return dict(model=ENGLISH.name, seconds=0.2, words=[
            dict(text='Hello', start=0.8, end=1.2, confidence=0.9),
            dict(text='world', start=1.4, end=1.8, confidence=0.8)])

    def test_source_size_and_digest_must_both_match_the_pinned_singing_sample(self):
        for raw in (b'', b'not the source', bytes(SOURCE_BYTES)):
            with self.subTest(size=len(raw)), self.assertRaises(ValueError):
                admit_sample(raw)

    def test_real_smoke_report_counts_valid_automatic_output_without_reprinting_lyrics(self):
        report = check_recognition(self.transcript(), 10.0, self.processing())
        self.assertEqual((report['recognizedWords'], report['automaticCues']), (2, 1))
        self.assertEqual(report['recognizer'], ENGLISH.name)
        self.assertNotIn('words', report)
        self.assertNotIn('cues', report)

    def test_empty_unknown_or_wrong_recognizer_output_cannot_pass(self):
        for model, words in ((ENGLISH.name, []), (MULTILINGUAL.name, self.transcript()['words']), ('fake', self.transcript()['words'])):
            with self.subTest(model=model), self.assertRaises((ValueError, RuntimeError)):
                check_recognition(dict(model=model, words=words, seconds=0.2), 10.0,
                                  self.processing())

    def test_network_attempts_bad_memory_provenance_and_wrong_clip_length_cannot_pass(self):
        for metadata in (dict(model='other'), dict(modelSha256='0'*64), dict(offlineNetworkAttempts=1, peakRssKiB=1024),
                         dict(offlineNetworkAttempts=False, peakRssKiB=1024),
                         dict(offlineNetworkAttempts=0, peakRssKiB=0),
                         dict(offlineNetworkAttempts=0, peakRssKiB=MAX_WORKER_RSS_KIB+1)):
            with self.subTest(metadata=metadata), self.assertRaises(RuntimeError):
                check_recognition(self.transcript(), 10.0, {**self.processing(), **metadata})
        with self.assertRaises(RuntimeError):
            check_recognition(self.transcript(), 600.0, self.processing())

    def test_nonfinite_word_timing_is_refused_by_production_validation(self):
        transcript = self.transcript()
        transcript['words'][0]['start'] = float('nan')
        with self.assertRaises(ValueError):
            check_recognition(transcript, 10.0, self.processing())
