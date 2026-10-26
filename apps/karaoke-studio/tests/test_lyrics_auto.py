"""Automatic lyric lines and supplied-lyric alignment (pure, no ML packages)."""
import dataclasses
import hashlib
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest import mock
import wave
import zipfile

from karaoke.lyrics_auto import MAX_STEPS, align_lines, sung_count, word_timings, words_to_cues
from karaoke.model import validate_project
from karaoke import transcribe_worker, transcription
from karaoke.transcribe_worker import recognize, words_from
from karaoke.transcription import (
    ENGLISH, MULTILINGUAL, archive_model, asr_ready, installed_models, model_ready, sounds_english, validate_transcript,
)


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
        good = dict(model=ENGLISH.name, words=SUNG, seconds=3.5)
        self.assertEqual(validate_transcript(json.loads(json.dumps(good)), 40.0)['words'], SUNG)
        # Either recognizer's transcripts are readable and keep their model; unknown models are not.
        self.assertEqual(validate_transcript(dict(good, model=MULTILINGUAL.name), 40.0)['model'], MULTILINGUAL.name)
        with self.assertRaises(ValueError):
            validate_transcript(dict(good, model='whisper-large'), 40.0)
        for bad in (dict(good, model='other'), dict(good, extra=1), dict(good, words=[dict(text='x', start=5, end=4, confidence=1)]),
                    dict(good, words=[dict(text='x', start=1, end=99, confidence=1)]), dict(good, seconds=-1),
                    dict(good, words=[dict(text='late', start=5, end=6, confidence=1), dict(text='early', start=1, end=2, confidence=1)]),
                    dict(good, words=[dict(SUNG[0], confidence=1.5)]), dict(good, words=[{k: v for k, v in SUNG[0].items() if k != 'confidence'}])):
            with self.assertRaises(ValueError):
                validate_transcript(bad, 40.0)

    def test_model_readiness_requires_every_pinned_file_of_either_model(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertFalse(asr_ready(root))
            (root / ENGLISH.directory).mkdir()
            for name in ENGLISH.files:
                (root / ENGLISH.directory / name).write_bytes(b'not the model')
            self.assertFalse(asr_ready(root))
            # Stand-in models pinned to the files' real checksums: either one makes lyrics available.
            pinned = {name: hashlib.sha256(b'not the model').hexdigest() for name in ENGLISH.files}
            english = dataclasses.replace(ENGLISH, files=pinned)
            multilingual = dataclasses.replace(MULTILINGUAL, files=pinned)
            with mock.patch.object(transcription, 'ASR_MODELS', (english, multilingual)):
                self.assertEqual(installed_models(root), (english,))
                self.assertTrue(asr_ready(root))
                (root / ENGLISH.directory / 'tokens.txt').write_bytes(b'changed')
                self.assertFalse(asr_ready(root))
            self.assertFalse(model_ready(root, MULTILINGUAL))

    def test_english_is_recognized_from_the_first_words(self):
        self.assertTrue(sounds_english('Lay awake at night wondering how could I let it get this way'.split()))
        self.assertTrue(sounds_english('I don\u2019t know where the road is taking us tonight'.split()))
        self.assertFalse(sounds_english('je ne sais pas où va la route ce soir mon amour'.split()))
        self.assertFalse(sounds_english('ich weiß nicht wohin die Straße uns heute Nacht führt'.split()))
        self.assertFalse(sounds_english('no sé a dónde nos lleva el camino esta noche'.split()))
        # Words that are also Italian, German or Dutch ("a", "in", "is", "was", "so") do not count.
        self.assertFalse(sounds_english('a casa in giardino so was is a in'.split()))
        self.assertFalse(sounds_english(['the', 'you']), 'too few words to tell')
        # Only the first words decide.
        self.assertFalse(sounds_english('la vie en rose'.split() * 30 + 'the and you the and you'.split() * 20))

    def test_archives_are_matched_to_their_model_by_pinned_size(self):
        with tempfile.TemporaryDirectory() as directory:
            other = Path(directory) / 'other.tar.bz2'
            other.write_bytes(b'x' * 10)
            self.assertIsNone(archive_model(other))
            with mock.patch.object(transcription, 'ASR_MODELS', (dataclasses.replace(ENGLISH, archive_bytes=10), MULTILINGUAL)):
                self.assertEqual(archive_model(other).key, 'english')


class RecognizerChoiceTests(unittest.TestCase):
    """Which model hears the song, with stand-in recognizers (no ML packages)."""

    def run_choice(self, models, language, choice="auto"):
        sung = {'en': 'the night is young and you are mine tonight love'.split(),
                'fr': 'la nuit est jeune et toi tu es à moi'.split()}[language]
        phrases = [(index * 16000, index) for index in range(40)]
        loads, heard = [], []

        def phrase_words(recognizer, start, phrase):
            heard.append((recognizer, phrase))
            return [dict(text=f'{recognizer}:{word}' if recognizer == 'english' else word, start=start / 16000 + i * 0.1,
                         end=start / 16000 + i * 0.1 + 0.08, confidence=0.9) for i, word in enumerate(sung)]

        def load(model):
            loads.append(model.key)
            return model.key

        progress = []
        with mock.patch.object(transcribe_worker, 'recognize_phrase', phrase_words):
            model, result = recognize(phrases, load, models, lambda done, total: progress.append((done, total)), model_choice=choice)
        return model, result, loads, heard, progress

    def test_english_songs_are_heard_again_by_the_english_model(self):
        model, result, loads, heard, progress = self.run_choice((ENGLISH, MULTILINGUAL), 'en')
        self.assertEqual((model, loads), (ENGLISH, ['multilingual', 'english']))
        # 10 words a phrase: the multilingual model hears 10 phrases, then English hears all 40.
        self.assertEqual(sum(1 for recognizer, _ in heard if recognizer == 'multilingual'), 10)
        self.assertEqual([phrase for recognizer, phrase in heard if recognizer == 'english'], list(range(40)))
        self.assertTrue(all(word['text'].startswith('english:') for word in result))
        self.assertEqual(len(result), 400)
        self.assertEqual(progress[-1], (40, 40))

    def test_other_languages_continue_with_the_multilingual_model(self):
        model, result, loads, heard, progress = self.run_choice((ENGLISH, MULTILINGUAL), 'fr')
        self.assertEqual((model, loads), (MULTILINGUAL, ['multilingual']))
        self.assertEqual([phrase for _, phrase in heard], list(range(40)), 'each phrase heard once')
        self.assertEqual(len(result), 400)
        self.assertEqual(progress, [(0, 40)] + [(done, 40) for done in range(1, 41)])

    def test_an_explicit_choice_bypasses_detection_and_hears_every_phrase(self):
        for choice, chosen, language in (("english", ENGLISH, "fr"), ("multilingual", MULTILINGUAL, "en")):
            model, result, loads, heard, progress = self.run_choice((ENGLISH, MULTILINGUAL), language, choice)
            self.assertEqual((model, loads), (chosen, [choice]))
            self.assertEqual([phrase for _, phrase in heard], list(range(40)))
            self.assertEqual(len(result), 400)
            self.assertEqual(progress, [(0, 40)] + [(done, 40) for done in range(1, 41)])

    def test_missing_or_invalid_choice_never_loads_a_fallback(self):
        for choice, models in (("english", (MULTILINGUAL,)), ("multilingual", (ENGLISH,)), ("auto", ())):
            with self.assertRaisesRegex(RuntimeError, "setup_lyrics_model.py"):
                self.run_choice(models, "en", choice)
        for choice in ("French", None, True, ["english"]):
            with self.assertRaises(ValueError):
                self.run_choice((ENGLISH, MULTILINGUAL), "en", choice)

    def test_a_single_installed_model_hears_everything(self):
        for models, language in (((ENGLISH,), 'fr'), ((MULTILINGUAL,), 'en')):
            model, _result, loads, heard, _progress = self.run_choice(models, language)
            self.assertEqual((model, loads), (models[0], [models[0].key]))
            self.assertEqual(len(heard), 40)


class TranscriptionChoiceBoundaryTests(unittest.TestCase):
    def test_parent_passes_choice_to_worker_and_keeps_installed_model_error_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'transcript.json'
            command = []

            def run(args, *_args, **_kwargs):
                command.extend(args)
                output.write_text(json.dumps(dict(model=MULTILINGUAL.name, words=SUNG, seconds=0.1)))

            with mock.patch.object(transcription, 'installed_models', return_value=(ENGLISH, MULTILINGUAL)), mock.patch.object(transcription, '_run', run):
                result = transcription.transcribe_vocals(root / 'vocals.wav', output, root, 40, threading.Event(), lambda _: None, model_choice='multilingual')
            self.assertEqual(result['model'], MULTILINGUAL.name)
            self.assertEqual(command[command.index('--model-choice') + 1], 'multilingual')
            output.unlink()
            with mock.patch.object(transcription, 'installed_models', return_value=(ENGLISH,)), mock.patch.object(transcription, '_run') as worker:
                with self.assertRaisesRegex(RuntimeError, '--only multilingual'):
                    transcription.transcribe_vocals(root / 'vocals.wav', output, root, 40, threading.Event(), lambda _: None, model_choice='multilingual')
                worker.assert_not_called()
            self.assertFalse(output.exists())


def silent_separation(source, output_dir, model_root, cancel, stage, *, duration=40):
    output_dir.mkdir(parents=True, exist_ok=True)
    for name in ('source.wav', 'vocals.wav', 'backing.wav'):
        with wave.open(str(output_dir / name), 'wb') as audio:
            audio.setparams((2, 2, 44100, 0, 'NONE', 'not compressed'))
            audio.writeframes(b'\0' * (44100 * 4 * duration))
    return float(duration)


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
            transcript = dict(model=ENGLISH.name, words=SUNG, seconds=0.1)
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
        self.assertNotIn('recognitionFailed', job)
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

        # Portable archives retain recognition separately from corrected saved lyric cues.
        status, _, backup = self.request('POST', base + '/archive', {'revision': project['revision']})
        self.assertEqual(status, 202, backup)
        self.assertEqual(self.helper.wait_job(backup['job']['id'])['status'], 'complete')
        status, _, archive = self.request('GET', base + '/archive')
        self.assertEqual(status, 200)
        names = zipfile.ZipFile(io.BytesIO(archive)).namelist()
        self.assertIn('project.json', names)
        self.assertIn('transcript.json', names)

    def test_cancelled_upload_recognition_retains_stems_without_partial_transcript(self):
        previous_id = self.helper.upload()['projectId']
        previous = self.request('GET', f'/api/projects/{previous_id}')[2]
        original = self.server.transcribe
        entered = threading.Event()

        def waiting(vocals, output, model_root, duration, cancel, stage):
            Path(output).write_text('{"partial": true}')
            stage('Recognizing sung lyrics locally')
            entered.set()
            if not cancel.wait(3):
                raise RuntimeError('Test did not cancel recognition.')
            raise RuntimeError('Recognition cancelled.')

        self.server.transcribe = waiting
        status, _, response = self.request('POST', '/api/projects', b'fake-audio', {'X-Audio-Name': 'retained.wav'})
        self.assertEqual(status, 202, response)
        started = response['job']
        self.assertTrue(entered.wait(2))
        self.assertEqual(self.request('POST', f'/api/jobs/{started["id"]}/cancel', {})[0], 200)
        done = self.helper.wait_job(started['id'])
        self.assertEqual(done['status'], 'complete', done)
        self.assertTrue(done['retainedOnCancel'])
        self.assertNotIn('recognitionFailed', done)
        base = f'/api/projects/{started["projectId"]}'
        project = self.request('GET', base)[2]
        self.assertEqual(project['cues'], [])
        for track in ('original', 'vocals', 'backing'):
            status, _, media = self.request('GET', base + '/audio/' + track)
            self.assertEqual(status, 200)
            self.assertTrue(media.startswith(b'RIFF'))
        self.assertEqual(self.request('GET', base + '/transcript')[2], {'available': False})
        self.assertFalse(list(self.server.work_dir.iterdir()))
        self.assertEqual(self.request('GET', f'/api/projects/{previous_id}')[2], previous)
        self.server.transcribe = original
        status, _, response = self.request('POST', base + '/transcribe', {})
        self.assertEqual(status, 202, response)
        self.assertEqual(self.helper.wait_job(response['job']['id'])['status'], 'complete')
        self.assertTrue(self.request('GET', base + '/transcript')[2]['available'])
        self.assertEqual(self.request('GET', base)[2], project, 'recognition retry does not replace saved cues')

    def test_late_cancel_before_publication_still_removes_recognition_results(self):
        from karaoke import server as server_module
        staged, release = threading.Event(), threading.Event()
        self.addCleanup(release.set)
        atomic_json = server_module._atomic_json

        def gate(path, value):
            atomic_json(path, value)
            if path.name == 'project.json' and path.parent.name == 'completed':
                staged.set()
                release.wait(2)

        with mock.patch.object(server_module, '_atomic_json', side_effect=gate):
            response = self.request('POST', '/api/projects', b'fake-audio', {'X-Audio-Name': 'late.wav'})[2]
            job = response['job']
            self.assertTrue(staged.wait(2))
            self.request('POST', f'/api/jobs/{job["id"]}/cancel', {})
            release.set()
            done = self.helper.wait_job(job['id'])
        self.assertEqual(done['status'], 'complete')
        self.assertTrue(done['retainedOnCancel'])
        self.assertNotIn('recognitionFailed', done)
        base = f'/api/projects/{job["projectId"]}'
        self.assertEqual(self.request('GET', base)[2]['cues'], [])
        self.assertEqual(self.request('GET', base + '/transcript')[2], {'available': False})

    def test_shutdown_during_recognition_saves_finished_stems_and_reopens_them(self):
        entered = threading.Event()

        def waiting(vocals, output, model_root, duration, cancel, stage):
            entered.set()
            if not cancel.wait(3):
                raise RuntimeError('Shutdown did not cancel recognition.')
            raise RuntimeError('Recognition cancelled by shutdown.')

        self.server.transcribe = waiting
        response = self.request('POST', '/api/projects', b'fake-audio', {'X-Audio-Name': 'shutdown.wav'})[2]
        self.assertTrue(entered.wait(2))
        self.server.shutdown()
        self.server.server_close()
        self.server = self.helper.start_server(separate=silent_separation, transcribe=waiting,
                                                transcriber_ready=lambda _root: True)
        self.helper.server = self.server
        self.helper.token = self.helper.request('GET', '/api/session')[2]['token']
        project_id = response['job']['projectId']
        status, _, project = self.request('GET', f'/api/projects/{project_id}')
        self.assertEqual(status, 200, project)
        self.assertEqual(project['cues'], [])
        self.assertEqual(self.request('GET', f'/api/projects/{project_id}/audio/backing')[0], 200)
        self.assertFalse(list(self.server.work_dir.iterdir()))

    def test_long_changed_transcript_aligns_through_http_without_changing_saved_cues(self):
        self.server.separate = lambda *args: silent_separation(*args, duration=80)
        self.helper.upload()
        project = self.request('GET', '/api/projects')[2]['projects'][0]
        base = f'/api/projects/{project["id"]}'
        tokens = ['one', 'two', 'three', 'four', 'five', 'six'] * 200
        heard = [dict(text=t, start=i * .06, end=i * .06 + .05, confidence=.9)
                 for i, t in enumerate(tokens)]
        heard[603]['text'] = 'wrong'
        path = self.helper.root / 'data' / 'projects' / project['id'] / 'transcript.json'
        path.write_text(json.dumps(dict(model=ENGLISH.name, words=heard, seconds=.1)))
        lines = [' '.join(tokens[i:i+12]) for i in range(0, len(tokens), 12)]
        status, _, aligned = self.request('POST', base + '/align', {'lines': lines})
        self.assertEqual(status, 200, aligned)
        self.assertEqual([c['text'] for c in aligned['cues']], lines)
        self.assertEqual(aligned['cues'][-1]['matched'], 1)
        self.assertAlmostEqual(aligned['cues'][-1]['start'], 71.13)
        status, _, timed = self.request('POST', base + '/word-timings', {
            'cues': [{k: c[k] for k in ('start', 'end', 'text')} for c in aligned['cues']]})
        self.assertEqual(status, 200, timed)
        self.assertTrue(timed['recognized'])
        self.assertTrue(any(w['heard'] for w in timed['lines'][-1]))
        self.assertEqual(self.request('GET', base)[2], project)

    def test_exhausted_alignment_is_explained_and_preserves_saved_cues(self):
        from karaoke.word_alignment import AlignmentLimitError
        self.helper.upload()
        project = self.request('GET', '/api/projects')[2]['projects'][0]
        base = f'/api/projects/{project["id"]}'
        for route, body in (('/align', {'lines': ['changed words']}),
                            ('/word-timings', {'cues': project['cues']})):
            function = 'align_lines' if route == '/align' else 'word_timings'
            with mock.patch('karaoke.server.' + function, side_effect=AlignmentLimitError('Lyrics differ too much; retry.')):
                status, _, result = self.request('POST', base + route, body)
            self.assertEqual(status, 400, result)
            self.assertIn('differ too much', result['error'])
            self.assertEqual(self.request('GET', base)[2], project)

    def test_chosen_retry_preserves_saved_cues_and_failed_retry_preserves_transcript(self):
        self.helper.upload()
        project = self.request('GET', '/api/projects')[2]['projects'][0]
        base = f'/api/projects/{project["id"]}'
        before = self.request('GET', base + '/transcript')[2]
        original = self.server.transcribe

        def chosen(*args, model_choice="auto"):
            self.assertEqual(model_choice, 'multilingual')
            transcript = original(*args)
            transcript['model'] = MULTILINGUAL.name
            Path(args[1]).write_text(json.dumps(transcript))
            return transcript

        self.server.transcribe = chosen
        status, _, started = self.request('POST', base + '/transcribe', {'modelChoice': 'multilingual'})
        self.assertEqual(status, 202, started)
        self.assertEqual(self.helper.wait_job(started['job']['id'])['status'], 'complete')
        after = self.request('GET', base + '/transcript')[2]
        self.assertEqual(after['model'], MULTILINGUAL.name)
        self.assertNotEqual(after['model'], before['model'])
        self.assertEqual(self.request('GET', base)[2], project)

        def missing(*args, **kwargs):
            raise RuntimeError('Requested English model missing; run scripts/setup_lyrics_model.py --only english.')

        self.server.transcribe = missing
        status, _, started = self.request('POST', base + '/transcribe', {'modelChoice': 'english'})
        self.assertEqual(status, 202, started)
        failed = self.helper.wait_job(started['job']['id'])
        self.assertEqual(failed['status'], 'failed')
        self.assertIn('setup_lyrics_model.py', failed['error'])
        self.assertEqual(self.request('GET', base + '/transcript')[2], after)
        self.assertEqual(self.request('GET', base)[2], project)
        for bad in ({'modelChoice': 'French'}, {'modelChoice': None}, {'modelChoice': []}, {'modelChoice': True},
                    {'modelChoice': 'auto', 'extra': 1}):
            self.assertEqual(self.request('POST', base + '/transcribe', bad)[0], 400)

    def test_recognition_failure_keeps_the_clip_and_a_missing_transcript_is_explained(self):
        self.fail_next = True
        job = self.helper.upload()
        self.assertEqual(job['status'], 'complete', 'the separated clip is kept')
        self.assertTrue(job.get('recognitionFailed'), job)
        self.assertNotIn('error', job)
        self.assertEqual(job['stage'], 'Stems saved; recognition failed')
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

    def test_successful_empty_recognition_is_not_reported_as_a_worker_failure(self):
        def empty(_vocals, output, *_args):
            transcript = dict(model=ENGLISH.name, words=[], seconds=0.1)
            Path(output).write_text(json.dumps(transcript))
            return transcript
        self.server.transcribe = empty
        job = self.helper.upload()
        self.assertEqual(job['status'], 'complete', job)
        self.assertNotIn('recognitionFailed', job)
        self.assertNotIn('error', job)
        self.assertEqual(self.request('GET', '/api/projects')[2]['projects'][0]['cues'], [])

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

        def slow(vocals, output, model_root, duration, cancel, stage, *, model_choice="auto"):
            self.assertEqual(model_choice, "multilingual")
            gate.set()
            while not cancel.wait(0.01):
                pass
            raise RuntimeError('cancelled')

        self.server.transcribe = slow
        started = self.request('POST', f'/api/projects/{project["id"]}/transcribe', {'modelChoice': 'multilingual'})[2]['job']
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
