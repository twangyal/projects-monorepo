"""Automatic lyric lines and supplied-lyric alignment (pure, no ML packages)."""
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import wave
import zipfile

from karaoke.lyrics_auto import MAX_STEPS, align_lines, sung_count, word_timings, words_to_cues
from karaoke.model import validate_project
from karaoke.transcribe_worker import words_from
from karaoke.transcription import MODEL_NAME, asr_ready, validate_transcript


def words(spec):
    """'text@start-end ...' to word dicts."""
    result = []
    for item in spec.split():
        text, times = item.split('@')
        start, end = times.split('-')
        result.append(dict(text=text, start=float(start), end=float(end), confidence=0.9))
    return result


SUNG = words('Lay@18.5-18.8 awake@18.8-19.3 at@19.3-19.5 night@19.5-20.0 '
             'wondering@20.7-21.2 how@21.2-21.5 could@21.5-21.8 I@21.8-22.1 '
             'let@23.0-23.2 it@23.2-23.4 get@23.4-23.7 this@23.7-24.0 way@24.0-24.4 '
             'through@30.1-30.5 all@30.5-30.8 the@30.8-31.0 pain@31.0-31.9')


class AutomaticLineTests(unittest.TestCase):
    def test_pauses_and_length_make_singable_lines_that_form_a_valid_project(self):
        cues = words_to_cues(SUNG, 40.0)
        self.assertEqual([c['text'] for c in cues],
                         ['Lay awake at night', 'wondering how could I', 'let it get this way', 'through all the pain'])
        self.assertAlmostEqual(cues[0]['start'], 18.35)
        self.assertAlmostEqual(cues[0]['end'], 20.35)
        # A following line never starts before the previous one ends.
        for before, after in zip(cues, cues[1:]):
            self.assertLessEqual(before['end'], after['start'])
        validate_project(dict(schemaVersion=1, id='a' * 32, title='Song', duration=40.0, revision=0, cues=cues))

    def test_long_unbroken_singing_is_split_and_bounds_hold(self):
        flowing = [dict(text=f'word{i}', start=i * 0.3, end=i * 0.3 + 0.28) for i in range(300)]
        cues = words_to_cues(flowing, 90.0)
        self.assertTrue(all(len(c['text']) <= 40 for c in cues))
        self.assertEqual(' '.join(c['text'] for c in cues).split(), [w['text'] for w in flowing])
        self.assertEqual(words_to_cues([], 10.0), [])
        # Invalid or out-of-clip words are ignored rather than trusted.
        junk = [dict(text='', start=1, end=2), dict(text='ok', start=float('nan'), end=2), dict(text='late', start=50, end=51),
                dict(text='back', start=3, end=1), 'x', dict(text='fine', start=2, end=2.5)]
        self.assertEqual([c['text'] for c in words_to_cues(junk, 10.0)], ['fine'])
        many = [dict(text='la', start=i * 1.5, end=i * 1.5 + 0.2) for i in range(250)]
        self.assertEqual(len(words_to_cues(many, 300.0)), 200)


class AlignmentTests(unittest.TestCase):
    def test_supplied_lines_take_the_time_they_were_sung_despite_recognition_errors(self):
        heard = words('lay@18.5-18.8 awake@18.8-19.3 at@19.3-19.5 nite@19.5-20.0 '
                      'wandering@20.7-21.2 how@21.2-21.5 could@21.5-21.8 eye@21.8-22.1 '
                      'let@23.0-23.2 it@23.2-23.4 get@23.4-23.7 this@23.7-24.0 way@24.0-24.4 '
                      'through@30.1-30.5 all@30.5-30.8 the@30.8-31.0 pain@31.0-31.9')
        lines = ['Lay awake at night', 'Wondering how could I', 'Let it get this way', '(Instrumental hum)', 'Through all the pain']
        cues = align_lines(lines, heard, 40.0)
        self.assertEqual([c['text'] for c in cues], lines)
        self.assertAlmostEqual(cues[0]['start'], 18.35)
        self.assertAlmostEqual(cues[1]['start'], 20.55)
        self.assertAlmostEqual(cues[2]['start'], 22.85)
        self.assertEqual(cues[3]['matched'], 0.0, 'an unheard line is reported')
        self.assertTrue(24.0 < cues[3]['start'] < cues[4]['start'])
        self.assertAlmostEqual(cues[4]['start'], 29.95)
        self.assertGreaterEqual(cues[1]['matched'], 0.75)
        validate_project(dict(schemaVersion=1, id='a' * 32, title='Song', duration=40.0, revision=0,
                              cues=[{k: c[k] for k in ('start', 'end', 'text')} for c in cues]))

    def test_nothing_heard_spreads_lines_and_repeated_choruses_stay_in_order(self):
        cues = align_lines(['one', 'two', 'three'], [], 30.0)
        self.assertEqual(len(cues), 3)
        self.assertTrue(all(c['matched'] == 0 for c in cues))
        chorus = words('hey@1-1.4 ya@1.4-1.8 hey@10-10.4 ya@10.4-10.8')
        cues = align_lines(['hey ya', 'hey ya'], chorus, 20.0)
        self.assertAlmostEqual(cues[0]['start'], 0.85)
        self.assertAlmostEqual(cues[1]['start'], 9.85)
        self.assertEqual(align_lines(['  ', ''], chorus, 20.0), [])


class WordTimingTests(unittest.TestCase):
    def test_each_word_takes_the_time_it_was_sung_and_unheard_words_fall_between(self):
        cues = [dict(start=18.35, end=20.35, text='Lay awake at night'),
                # Corrected text: "wondering" was misheard as "wandering"; "oh" was never recognized.
                dict(start=20.55, end=22.45, text='Wandering oh how could I'),
                dict(start=25.0, end=28.0, text='an instrumental\nline nobody sang')]
        timed = word_timings(cues, SUNG, 40)
        self.assertEqual([(w['text'], w['start'], w['heard']) for w in timed[0]],
                         [('Lay', 18.5, True), ('awake', 18.8, True), ('at', 19.3, True), ('night', 19.5, True)])
        second = timed[1]
        self.assertEqual([w['text'] for w in second], ['Wandering', 'oh', 'how', 'could', 'I'])
        self.assertEqual((second[0]['start'], second[0]['heard']), (20.7, True), 'near-miss spelling still matches')
        self.assertFalse(second[1]['heard'])
        self.assertTrue(20.7 < second[1]['start'] < 21.2 == second[2]['start'])
        # A line with no recognized singing is spread across its interval by word length.
        third = timed[2]
        self.assertEqual([w['text'] for w in third], ['an', 'instrumental', 'line', 'nobody', 'sang'])
        self.assertFalse(any(w['heard'] for w in third))
        self.assertEqual(third[0]['start'], 25.0, 'a timed line starts when its singing starts')
        gaps = [b['start'] - a['start'] for a, b in zip(third, third[1:])]
        self.assertGreater(gaps[1], gaps[0] * 3, 'a long word lasts longer than a short one')
        self.assertLess(third[-1]['start'], 28.0 - 0.35)
        for line, cue in zip(timed, cues):
            starts = [w['start'] for w in line]
            self.assertEqual(starts, sorted(starts))
            self.assertTrue(all(cue['start'] <= s < cue['end'] for s in starts))
        self.assertEqual([sung_count(timed[0], t) for t in (18.4, 18.5, 19.4, 25)], [0, 1, 3, 4])

    def test_retimed_lines_and_stray_matches_stay_inside_the_line(self):
        # A line moved earlier than its singing keeps every word inside its own interval.
        moved = word_timings([dict(start=17.0, end=18.7, text='Lay awake')], SUNG, 40)[0]
        self.assertTrue(all(17.0 <= w['start'] < 18.7 for w in moved))
        # "awake" was sung before "night", so in this order it cannot be trusted and is placed after it.
        backwards = word_timings([dict(start=18.0, end=24.5, text='night awake')], SUNG, 40)[0]
        self.assertEqual([(w['start'], w['heard']) for w in backwards], [(19.5, True), (21.825, False)])

    def test_long_lines_highlight_in_bounded_steps_and_punctuation_is_timed(self):
        text = ' '.join(f'word{i}' for i in range(50)) + ' —'
        timed = word_timings([dict(start=0.0, end=30.0, text=text)], [], 40)[0]
        self.assertEqual(len(timed), 51)
        self.assertEqual(len({w['start'] for w in timed}), MAX_STEPS)
        self.assertEqual(word_timings([dict(start=1.0, end=2.0, text='— !')], SUNG, 40)[0][0]['heard'], False)


class TranscriptTests(unittest.TestCase):
    def test_subword_tokens_become_words_with_times(self):
        tokens = [' Lay', ' a', 'wake', ' at', ' night', '.']
        log_probs = [0.0, -0.2, -0.6, -0.01, float('nan'), -2.0]
        result = words_from(tokens, [0.0, 0.32, 0.4, 0.8, 1.0, 1.5], [0.3, 0.08, 0.3, 0.2, 0.4, 0.04], 18.5, log_probs)
        self.assertEqual([w['text'] for w in result], ['Lay', 'awake', 'at', 'night.'])
        self.assertEqual((result[1]['start'], result[1]['end']), (18.82, 19.2))
        # Geometric mean of token probabilities: exp((-0.2 - 0.6) / 2).
        self.assertEqual([w['confidence'] for w in result], [1.0, 0.67, 0.99, 0.368])
        self.assertEqual(words_from([' la'], [0.0], [], 0)[0]['confidence'], 1.0, 'no probabilities reported')

    def test_stored_transcripts_are_strictly_validated(self):
        good = dict(model=MODEL_NAME, words=SUNG, seconds=3.5)
        self.assertEqual(validate_transcript(json.loads(json.dumps(good)), 40.0)['words'], SUNG)
        for bad in (dict(good, model='other'), dict(good, extra=1), dict(good, words=[dict(text='x', start=5, end=4, confidence=1)]),
                    dict(good, words=[dict(text='x', start=1, end=99, confidence=1)]), dict(good, seconds=-1),
                    dict(good, words=[dict(text='late', start=5, end=6, confidence=1), dict(text='early', start=1, end=2, confidence=1)]),
                    dict(good, words=[dict(SUNG[0], confidence=1.5)]), dict(good, words=[{k: v for k, v in SUNG[0].items() if k != 'confidence'}])):
            with self.assertRaises(ValueError):
                validate_transcript(bad, 40.0)

    def test_model_readiness_requires_every_pinned_file(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertFalse(asr_ready(Path(directory)))
            (Path(directory) / 'lyrics-asr').mkdir()
            for name in ('encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt', 'silero_vad.onnx'):
                (Path(directory) / 'lyrics-asr' / name).write_bytes(b'not the model')
            self.assertFalse(asr_ready(Path(directory)))


def silent_separation(source, output_dir, model_root, cancel, stage):
    output_dir.mkdir(parents=True, exist_ok=True)
    for name in ('source.wav', 'vocals.wav', 'backing.wav'):
        with wave.open(str(output_dir / name), 'wb') as audio:
            audio.setparams((2, 2, 44100, 0, 'NONE', 'not compressed'))
            audio.writeframes(b'\0' * (44100 * 4 * 40))
    return 40.0


class ServerLyricsTests(unittest.TestCase):
    """The HTTP flow with an injected recognizer; the real model runs in scripts/evaluate_lyrics.py."""

    def setUp(self):
        from tests.test_server import ServerTests
        self.calls = []
        self.fail_next = False

        def transcribe(vocals, output, model_root, duration, cancel, stage):
            self.calls.append(Path(vocals).name)
            stage('Recognizing sung lyrics locally')
            if self.fail_next:
                self.fail_next = False
                raise RuntimeError('Recognition broke.')
            assert Path(vocals).is_file()
            transcript = dict(model=MODEL_NAME, words=SUNG, seconds=0.1)
            Path(output).write_text(json.dumps(transcript))
            return transcript

        self.helper = ServerTests('run')
        self.helper.setUp = lambda: None
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.helper.root = Path(self.temp.name)
        self.helper.dist = self.helper.root / 'dist'
        self.helper.dist.mkdir()
        (self.helper.dist / 'index.html').write_text('<h1>test</h1>')
        self.helper.addCleanup = self.addCleanup
        self.server = self.helper.start_server(separate=silent_separation, transcribe=transcribe,
                                               transcriber_ready=lambda _root: True)
        self.helper.server = self.server
        self.helper.token = self.helper.request('GET', '/api/session')[2]['token']

    def request(self, *args):
        return self.helper.request(*args)

    def test_upload_starts_with_automatic_lyrics_that_can_be_aligned_and_retranscribed(self):
        self.assertTrue(self.request('GET', '/api/session')[2]['lyricsModelReady'])
        job = self.helper.upload()
        self.assertEqual(job['status'], 'complete', job)
        project = self.request('GET', '/api/projects')[2]['projects'][0]
        self.assertEqual([c['text'] for c in project['cues']][:2], ['Lay awake at night', 'wondering how could I'])
        self.assertEqual(self.calls, ['vocals.wav'])
        base = f'/api/projects/{project["id"]}'
        status, _, transcript = self.request('GET', base + '/transcript')
        self.assertEqual((status, transcript['available'], transcript['words'], len(transcript['cues'])), (200, True, len(SUNG), 4))

        status, _, aligned = self.request('POST', base + '/align', {'lines': ['Lay awake at night', 'through all the pain']})
        self.assertEqual(status, 200, aligned)
        self.assertEqual([round(c['start'], 2) for c in aligned['cues']], [18.35, 29.95])
        for bad in ({'lines': []}, {'lines': ['x' * 241]}, {'lines': 'text'}, {'lines': ['ok'], 'extra': 1}, {'lines': ['  ']}):
            self.assertEqual(self.request('POST', base + '/align', bad)[0], 400, bad)

        status, _, started = self.request('POST', base + '/transcribe', {})
        self.assertEqual(status, 202, started)
        done = self.helper.wait_job(started['job']['id'])
        self.assertEqual((done['kind'], done['status'], done['resultUrl']), ('transcribe', 'complete', base + '/transcript'))
        self.assertEqual(self.request('GET', base)[2]['cues'], project['cues'], 'transcribing again never replaces saved lyrics')

        # Word timings for the current (possibly unsaved) lines, from the recognized words.
        status, _, timed = self.request('POST', base + '/word-timings', {'cues': project['cues'][:1]})
        self.assertEqual(status, 200, timed)
        self.assertEqual((timed['recognized'], [w['start'] for w in timed['lines'][0]]), (True, [18.5, 18.8, 19.3, 19.5]))
        for bad in ({}, {'cues': 'x'}, {'cues': [{'start': 2, 'end': 1, 'text': 'x'}]}, {'cues': [], 'extra': 1},
                    {'cues': [{'start': 0, 'end': 1, 'text': 'x' * 241}]}):
            self.assertEqual(self.request('POST', base + '/word-timings', bad)[0], 400, bad)
        # Exports receive the recognized words so the video highlights the same way as the preview.
        exported = []
        self.server.export = lambda *args, **options: (exported.append(options), Path(args[2]).write_bytes(b'video'))
        status, _, started = self.request('POST', base + '/export', {})
        self.assertEqual(status, 202, started)
        self.assertEqual(self.helper.wait_job(started['job']['id'])['status'], 'complete')
        self.assertEqual(exported[0]['words'][0]['text'], 'Lay')

        # Portable archives keep their exact format: the transcript stays local and can be recreated.
        status, _, backup = self.request('POST', base + '/archive', {'revision': project['revision']})
        self.assertEqual(status, 202, backup)
        self.assertEqual(self.helper.wait_job(backup['job']['id'])['status'], 'complete')
        status, _, archive = self.request('GET', base + '/archive')
        self.assertEqual(status, 200)
        names = zipfile.ZipFile(io.BytesIO(archive)).namelist()
        self.assertIn('project.json', names)
        self.assertNotIn('transcript.json', names)

    def test_recognition_failure_keeps_the_clip_and_a_missing_transcript_is_explained(self):
        self.fail_next = True
        job = self.helper.upload()
        self.assertEqual(job['status'], 'complete', 'the separated clip is kept')
        project = self.request('GET', '/api/projects')[2]['projects'][0]
        self.assertEqual(project['cues'], [])
        base = f'/api/projects/{project["id"]}'
        self.assertEqual(self.request('GET', base + '/transcript')[2], {'available': False})
        status, _, error = self.request('POST', base + '/align', {'lines': ['hello']})
        self.assertEqual(status, 409)
        self.assertIn('Transcribe', error['error'])
        # A corrupt stored transcript is reported, not trusted.
        (self.helper.root / 'data' / 'projects' / project['id'] / 'transcript.json').write_text('{"model": "x"}')
        self.assertEqual(self.request('GET', base + '/transcript')[0], 409)
        # Word highlighting still works from estimates, for previews and exports alike.
        status, _, timed = self.request('POST', base + '/word-timings', {'cues': [{'start': 1, 'end': 3, 'text': 'hello there'}]})
        self.assertEqual((status, timed['recognized'], [w['heard'] for w in timed['lines'][0]]), (200, False, [False, False]))

    def test_transcription_needs_the_model_and_cancels_cleanly(self):
        job = self.helper.upload()
        project = self.request('GET', '/api/projects')[2]['projects'][0]
        self.server.transcriber_ready = lambda _root: False
        status, _, error = self.request('POST', f'/api/projects/{project["id"]}/transcribe', {})
        self.assertEqual(status, 409)
        self.assertIn('setup_lyrics_model.py', error['error'])
        self.assertFalse(self.request('GET', '/api/session')[2]['lyricsModelReady'])
        self.server.transcriber_ready = lambda _root: True
        gate = threading.Event()

        def slow(vocals, output, model_root, duration, cancel, stage):
            gate.set()
            while not cancel.wait(0.01):
                pass
            raise RuntimeError('cancelled')

        self.server.transcribe = slow
        started = self.request('POST', f'/api/projects/{project["id"]}/transcribe', {})[2]['job']
        gate.wait(2)
        self.request('POST', f'/api/jobs/{started["id"]}/cancel', {})
        deadline = time.monotonic() + 3
        while self.request('GET', f'/api/jobs/{started["id"]}')[2]['job']['status'] == 'running' and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(self.request('GET', f'/api/jobs/{started["id"]}')[2]['job']['status'], 'cancelled')
        self.assertTrue((self.helper.root / 'data' / 'projects' / project['id'] / 'transcript.json').exists(),
                        'the earlier transcript survives a cancelled run')
        self.assertEqual(job['status'], 'complete')


if __name__ == '__main__':
    unittest.main()
