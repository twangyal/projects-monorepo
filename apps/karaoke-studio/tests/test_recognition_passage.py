"""Passage retries use real media cropping and deterministic recognition output."""
import copy
import io
import json
from pathlib import Path
import threading
import unittest
import wave
import zipfile

from tests import test_lyrics_auto as lyrics_test
from tests.test_lyrics_auto import words
from karaoke.transcription import MULTILINGUAL


class RecognitionPassageTests(unittest.TestCase):
    setUp = lyrics_test.ServerLyricsTests.setUp
    request = lyrics_test.ServerLyricsTests.request

    def clip(self):
        self.helper.upload()
        project = self.request('GET', '/api/projects')[2]['projects'][0]
        return project, f'/api/projects/{project["id"]}'

    def recognize(self, vocals, output, model_root, duration, cancel, stage, *, model_choice='auto'):
        with wave.open(str(vocals), 'rb') as audio:
            self.assertAlmostEqual(audio.getnframes() / audio.getframerate(), duration, places=3)
            self.assertEqual(audio.getnchannels(), 2)
        self.assertEqual(duration, 5)
        self.assertEqual(model_choice, 'multilingual')
        value = dict(model=MULTILINGUAL.name, words=words('Better@0.1-0.5 words@0.6-1.2'), seconds=0.1)
        Path(output).write_text(json.dumps(value))
        return value

    def retry(self, base):
        self.server.transcribe = self.recognize
        status, _, value = self.request('POST', base + '/transcribe-passage', dict(start=5, end=10, modelChoice='multilingual'))
        self.assertEqual(status, 202, value)
        self.assertEqual(value['job']['kind'], 'transcribe-passage')
        done = self.helper.wait_job(value['job']['id'])
        self.assertEqual(done['status'], 'complete', done)
        self.assertEqual(done['resultUrl'], base + '/recognition-passage')
        return self.request('GET', base + '/recognition-passage')[2]

    def test_cropped_vocals_produce_song_time_preview_without_changing_reference_or_lyrics(self):
        project, base = self.clip()
        reference = self.request('GET', base + '/transcript')[2]
        preview = self.retry(base)
        self.assertTrue(preview['available'])
        self.assertEqual((preview['start'], preview['end']), (5, 10))
        cue = preview['candidate']['cues'][0]
        self.assertEqual(cue['text'], 'Better words')
        self.assertEqual(cue['words'][0]['start'], 5.1)
        self.assertGreaterEqual(cue['start'], 5)
        self.assertLessEqual(cue['end'], 10)
        self.assertEqual(self.request('GET', base + '/transcript')[2], reference)
        self.assertEqual(self.request('GET', base)[2], project)
        self.assertEqual(self.request('GET', base + '/recognition-preview')[2], {'available': False})
        self.assertFalse(list(self.server.work_dir.iterdir()))

    def test_fractional_bounds_and_tail_words_remain_readable_after_song_time_conversion(self):
        _, base = self.clip()
        for start, end in [(5, 10), (5.0004, 10.0004), (5.0000004, 10)]:
            def boundary(vocals, output, model_root, duration, cancel, stage, **kwargs):
                value = dict(model=MULTILINGUAL.name, words=[
                    dict(text='First', start=0, end=0.2, confidence=0.9),
                    dict(text='Last', start=duration - 0.01, end=duration + 0.2, confidence=0.9)], seconds=0.1)
                Path(output).write_text(json.dumps(value))
            self.server.transcribe = boundary
            status, _, value = self.request('POST', base + '/transcribe-passage', dict(start=start, end=end))
            self.assertEqual(status, 202, value)
            done = self.helper.wait_job(value['job']['id'])
            self.assertEqual(done['status'], 'complete', done)
            status, _, preview = self.request('GET', base + '/recognition-passage')
            self.assertEqual(status, 200, preview)
            for cue in preview['candidate']['cues']:
                self.assertTrue(start <= cue['start'] < cue['end'] <= end, cue)
                for word in cue['words']:
                    self.assertTrue(start <= word['start'] <= word['end'] <= end, word)

    def test_unpresentable_worker_output_preserves_the_previous_preview(self):
        _, base = self.clip()
        preview = self.retry(base)
        def too_many(vocals, output, model_root, duration, cancel, stage, **kwargs):
            value = dict(model=MULTILINGUAL.name, words=[dict(text='x' * 60, start=0.001 * i, end=0.001 * i + 0.1, confidence=0.9) for i in range(2800)], seconds=0.1)
            Path(output).write_text(json.dumps(value))
        self.server.transcribe = too_many
        started = self.request('POST', base + '/transcribe-passage', dict(start=5, end=10))[2]['job']
        self.assertEqual(self.helper.wait_job(started['id'])['status'], 'failed')
        self.assertEqual(self.request('GET', base + '/recognition-passage')[2], preview)

    def test_ranges_and_choices_are_validated_before_starting_media_work(self):
        _, base = self.clip()
        bad = [dict(start=a, end=b) for a, b in [(True, 6), (0, False), (-1, 4), (5, 5), (6, 5), (0, 41), (0, 0.5), ('5', 10), (None, 10)]]
        bad += [dict(start=5, end=10, modelChoice='missing'), dict(start=5, end=10, extra=True), {}, dict(start=5)]
        for value in bad:
            with self.subTest(value=value):
                self.assertEqual(self.request('POST', base + '/transcribe-passage', value)[0], 400)
        self.assertFalse(list(self.server.work_dir.iterdir()))

    def test_failed_cancelled_and_malformed_results_keep_the_last_preview(self):
        _, base = self.clip()
        preview = self.retry(base)
        for kind in ('failed', 'malformed', 'out-of-range', 'cancelled'):
            entered = threading.Event()
            def bad(vocals, output, model_root, duration, cancel, stage, **kwargs):
                entered.set()
                if kind == 'cancelled':
                    cancel.wait(5)
                if kind in ('failed', 'cancelled'):
                    raise RuntimeError('Recognition interrupted.')
                value = dict(model=MULTILINGUAL.name, words=words('late@7-8'), seconds=0.1) if kind == 'out-of-range' else {'bad': True}
                Path(output).write_text(json.dumps(value))
            self.server.transcribe = bad
            started = self.request('POST', base + '/transcribe-passage', dict(start=5, end=10))[2]['job']
            self.assertTrue(entered.wait(3))
            if kind == 'cancelled':
                self.assertEqual(self.request('DELETE', base + '/recognition-passage', {'candidateId': preview['candidateId']})[0], 409)
                self.request('POST', f'/api/jobs/{started["id"]}/cancel', {})
            self.assertEqual(self.helper.wait_job(started['id'])['status'], 'cancelled' if kind == 'cancelled' else 'failed')
            self.assertEqual(self.request('GET', base + '/recognition-passage')[2], preview)

    def test_discard_is_identity_checked_and_pending_passage_is_excluded_from_backup(self):
        project, base = self.clip()
        preview = self.retry(base)
        self.assertEqual(self.request('DELETE', base + '/recognition-passage', {'candidateId': '0' * 64})[0], 409)
        self.assertEqual(self.request('DELETE', base + '/recognition-passage', {})[0], 400)
        started = self.request('POST', base + '/archive', {'revision': project['revision']})[2]['job']
        self.assertEqual(self.helper.wait_job(started['id'])['status'], 'complete')
        archive = self.request('GET', base + '/archive')[2]
        with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
            self.assertNotIn('recognition-passage.json', zipped.namelist())
        self.assertEqual(self.request('DELETE', base + '/recognition-passage', {'candidateId': preview['candidateId']})[0], 200)
        self.assertEqual(self.request('GET', base + '/recognition-passage')[2], {'available': False})
        self.assertEqual(self.request('GET', base)[2], project)

    def test_passage_cannot_be_kept_as_full_reference_and_full_retry_stays_independent(self):
        _, base = self.clip()
        full = copy.deepcopy(self.server.read_transcript(self.request('GET', base)[2]))
        folder = self.helper.root / 'data' / 'projects' / base.split('/')[-1]
        (folder / 'recognition-preview.json').write_text(json.dumps(full))
        before = self.request('GET', base + '/recognition-preview')[2]
        preview = self.retry(base)
        self.assertEqual(self.request('POST', base + '/recognition-passage', {'candidateId': preview['candidateId']})[0], 405)
        self.assertEqual(self.request('GET', base + '/recognition-preview')[2], before)


if __name__ == '__main__':
    unittest.main()
