import json
import copy
import threading
from pathlib import Path
import unittest

from tests import test_lyrics_auto as lyrics_test
from karaoke.transcription import MULTILINGUAL
from karaoke.alignment import ALIGNMENT_FILE


class RecognitionPreviewTests(unittest.TestCase):
    setUp = lyrics_test.ServerLyricsTests.setUp
    request = lyrics_test.ServerLyricsTests.request

    def clip(self):
        self.helper.upload()
        project = self.request('GET', '/api/projects')[2]['projects'][0]
        return project, f'/api/projects/{project["id"]}'

    def stage(self, base):
        original = self.server.transcribe

        def alternate(*args, **kwargs):
            value = copy.deepcopy(original(*args))
            value['model'] = MULTILINGUAL.name
            value['words'][0] = {**value['words'][0], 'text': 'Stay'}
            Path(args[1]).write_text(json.dumps(value))
            Path(args[1]).with_name(ALIGNMENT_FILE).write_bytes(b'new candidate letters')
            return value

        self.server.transcribe = alternate
        status, _, started = self.request('POST', base + '/transcribe', {'reviewOnly': True})
        self.assertEqual(status, 202, started)
        job = self.helper.wait_job(started['job']['id'])
        self.assertEqual(job['status'], 'complete', job)
        return self.request('GET', base + '/recognition-preview')

    def test_staging_keeps_reference_project_and_letter_measurements_until_explicit_keep(self):
        project, base = self.clip()
        before = self.request('GET', base + '/transcript')[2]
        folder = self.helper.root / 'data' / 'projects' / project['id']
        original_bytes = (folder / 'transcript.json').read_bytes()
        (folder / ALIGNMENT_FILE).write_bytes(b'existing saved letters')
        status, _, preview = self.stage(base)
        self.assertEqual(status, 200, preview)
        self.assertTrue(preview['available'])
        self.assertEqual(preview['current'], before)
        self.assertEqual(preview['candidate']['model'], MULTILINGUAL.name)
        self.assertEqual(len(preview['candidateId']), 64)
        self.assertEqual(self.request('GET', base + '/transcript')[2], before)
        self.assertEqual((folder / 'transcript.json').read_bytes(), original_bytes)
        self.assertEqual((folder / ALIGNMENT_FILE).read_bytes(), b'existing saved letters')
        self.assertEqual(self.request('GET', base)[2], project)
        ids = {key: preview[key] for key in ('candidateId', 'referenceId')}
        status, _, result = self.request('POST', base + '/recognition-preview', ids)
        self.assertEqual(status, 200, result)
        self.assertEqual(self.request('GET', base + '/transcript')[2], preview['candidate'])
        self.assertEqual(self.request('GET', base + '/recognition-preview')[2], {'available': False})
        self.assertEqual(self.request('GET', base)[2], project)
        self.assertEqual((folder / ALIGNMENT_FILE).read_bytes(), b'existing saved letters')

    def test_discard_preserves_reference_and_stale_identity_cannot_keep_or_discard(self):
        _, base = self.clip()
        before = self.request('GET', base + '/transcript')[2]
        preview = self.stage(base)[2]
        ids = {key: preview[key] for key in ('candidateId', 'referenceId')}
        for method in ('POST', 'DELETE'):
            status = self.request(method, base + '/recognition-preview', {**ids, 'candidateId': '0' * 64})[0]
            self.assertEqual(status, 409)
        self.assertEqual(self.request('POST', base + '/recognition-preview', {**ids, 'referenceId': '0' * 64})[0], 409)
        status, _, result = self.request('DELETE', base + '/recognition-preview', ids)
        self.assertEqual(status, 200, result)
        self.assertEqual(self.request('GET', base + '/transcript')[2], before)
        self.assertEqual(self.request('GET', base + '/recognition-preview')[2], {'available': False})

    def test_failed_retry_keeps_the_last_candidate_and_reference(self):
        _, base = self.clip()
        preview = self.stage(base)[2]
        reference = self.request('GET', base + '/transcript')[2]
        self.fail_next = True
        started = self.request('POST', base + '/transcribe', {'reviewOnly': True})[2]
        self.assertEqual(self.helper.wait_job(started['job']['id'])['status'], 'failed')
        self.assertEqual(self.request('GET', base + '/recognition-preview')[2], preview)
        self.assertEqual(self.request('GET', base + '/transcript')[2], reference)
        for bad in ({'reviewOnly': 1}, {'reviewOnly': 'true'}, {'reviewOnly': None}):
            self.assertEqual(self.request('POST', base + '/transcribe', bad)[0], 400)

    def test_staged_candidate_is_not_in_a_saved_clip_archive(self):
        import io
        import zipfile
        project, base = self.clip()
        reference = self.server.read_transcript(project)
        self.stage(base)
        started = self.request('POST', base + '/archive', {'revision': project['revision']})[2]
        self.assertEqual(self.helper.wait_job(started['job']['id'])['status'], 'complete')
        status, _, archive = self.request('GET', base + '/archive')
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
            self.assertEqual(json.loads(zipped.read('transcript.json')), reference)
            self.assertNotIn('recognition-preview.json', zipped.namelist())

    def test_cancelled_retry_and_active_job_cannot_replace_or_discard_the_old_candidate(self):
        _, base = self.clip()
        preview = self.stage(base)[2]
        ids = {key: preview[key] for key in ('candidateId', 'referenceId')}
        entered = threading.Event()

        def waiting(*args, **kwargs):
            entered.set()
            args[4].wait(5)
            raise RuntimeError('Recognition cancelled.')

        self.server.transcribe = waiting
        started = self.request('POST', base + '/transcribe', {'reviewOnly': True})[2]['job']
        self.assertTrue(entered.wait(2))
        for method in ('POST', 'DELETE'):
            self.assertEqual(self.request(method, base + '/recognition-preview', ids)[0], 409)
        self.request('POST', f'/api/jobs/{started["id"]}/cancel', {})
        self.assertEqual(self.helper.wait_job(started['id'])['status'], 'cancelled')
        self.assertEqual(self.request('GET', base + '/recognition-preview')[2], preview)

    def test_malformed_worker_output_and_a_changed_reference_refuse_without_losing_a_candidate(self):
        _, base = self.clip()
        preview = self.stage(base)[2]
        ids = {key: preview[key] for key in ('candidateId', 'referenceId')}
        original = self.server.transcribe

        def malformed(*args, **kwargs):
            Path(args[1]).write_text('{"not": "a transcript"}')

        self.server.transcribe = malformed
        started = self.request('POST', base + '/transcribe', {'reviewOnly': True})[2]['job']
        self.assertEqual(self.helper.wait_job(started['id'])['status'], 'failed')
        self.assertEqual(self.request('GET', base + '/recognition-preview')[2], preview)
        self.server.transcribe = original
        started = self.request('POST', base + '/transcribe', {})[2]['job']
        self.assertEqual(self.helper.wait_job(started['id'])['status'], 'complete')
        self.assertEqual(self.request('POST', base + '/recognition-preview', ids)[0], 409)
        self.assertEqual(self.request('GET', base + '/recognition-preview')[2]['candidate'], preview['candidate'])

    def test_first_manual_recognition_keeps_its_original_behavior_without_an_existing_reference(self):
        self.fail_next = True
        project, base = self.clip()
        self.assertEqual(self.request('GET', base + '/transcript')[2], {'available': False})
        started = self.request('POST', base + '/transcribe', {'reviewOnly': True})[2]['job']
        done = self.helper.wait_job(started['id'])
        self.assertEqual(done['resultUrl'], base + '/transcript')
        self.assertTrue(self.request('GET', base + '/transcript')[2]['available'])
        self.assertEqual(self.request('GET', base + '/recognition-preview')[2], {'available': False})
        self.assertEqual(self.request('GET', base)[2], project)

    def test_staging_keeps_existing_video_but_acceptance_invalidates_its_recognition_timing(self):
        project, base = self.clip()
        folder = self.helper.root / 'data' / 'projects' / project['id']
        (folder / 'video.mp4').write_bytes(b'old rendered video')
        (folder / 'video-revision.json').write_text(json.dumps({'revision': project['revision']}))
        preview = self.stage(base)[2]
        self.assertEqual(self.request('GET', base + '/video')[0], 200)
        ids = {key: preview[key] for key in ('candidateId', 'referenceId')}
        self.assertEqual(self.request('POST', base + '/recognition-preview', ids)[0], 200)
        self.assertEqual(self.request('GET', base + '/video')[0], 404)
        self.assertEqual((folder / 'video.mp4').read_bytes(), b'old rendered video')

    def test_legacy_recognition_replacement_also_retires_the_old_render_marker(self):
        project, base = self.clip()
        folder = self.helper.root / 'data' / 'projects' / project['id']
        (folder / 'video.mp4').write_bytes(b'old rendered video')
        (folder / 'video-revision.json').write_text(json.dumps({'revision': project['revision']}))
        started = self.request('POST', base + '/transcribe', {})[2]['job']
        self.assertEqual(self.helper.wait_job(started['id'])['status'], 'complete')
        self.assertEqual(self.request('GET', base + '/video')[0], 404)
        self.assertEqual((folder / 'video.mp4').read_bytes(), b'old rendered video')


if __name__ == '__main__':
    unittest.main()
