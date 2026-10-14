"""Evaluation cache identity; inference is injected, metrics are not invented."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from karaoke.transcription import ENGLISH, MULTILINGUAL
from karaoke import transcription
from scripts.evaluate_lyrics import process


class EvaluationCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.song = self.root / 'song.mp3'
        self.song.write_bytes(b'first audio')
        self.cap = 10
        self.separations = 0
        self.recognitions = 0

        def separate(source, media, *_args):
            self.separations += 1
            media.mkdir(parents=True)
            for name in ('source.wav', 'vocals.wav', 'backing.wav'):
                (media / name).write_bytes(b'fixture audio')
            return self.cap

        def transcribe(_vocals, output, _models, duration, *_args, model_choice='auto'):
            self.recognitions += 1
            installed = transcription.installed_models(_models)
            chosen = MULTILINGUAL if model_choice == 'multilingual' or ENGLISH not in installed else ENGLISH
            value = dict(model=chosen.name,
                         words=[dict(text=model_choice, start=0, end=duration, confidence=1)], seconds=1)
            output.write_text(json.dumps(value))
            return value

        for target, replacement in [('karaoke.pipeline.separate_clip', separate),
                                    ('karaoke.transcription.transcribe_vocals', transcribe),
                                    ('karaoke.transcription.installed_models', lambda _: (ENGLISH, MULTILINGUAL)),
                                    ('subprocess.run', lambda args, **kwargs: Path(args[-1]).write_bytes(b'decoded audio'))]:
            patch = mock.patch(target, replacement)
            patch.start()
            self.addCleanup(patch.stop)

    def run_song(self, choice='auto'):
        return process(self.song, self.root / 'work', self.root / 'models', self.cap, model_choice=choice)

    def test_chosen_models_have_separate_transcripts_but_share_identical_vocals(self):
        english = self.run_song('english')
        multilingual = self.run_song('multilingual')
        self.assertEqual((english['words'][0]['text'], multilingual['words'][0]['text']), ('english', 'multilingual'))
        self.assertEqual((self.separations, self.recognitions), (1, 2))
        self.assertEqual(self.run_song('english'), english)
        self.assertEqual((self.separations, self.recognitions), (1, 2))

    def test_changed_clip_bound_or_source_bytes_cannot_return_stale_timings(self):
        before = process(self.song, self.root / 'work', self.root / 'models', self.cap)
        self.cap = 20
        longer = process(self.song, self.root / 'work', self.root / 'models', self.cap)
        self.assertEqual((before['duration'], longer['duration']), (10, 20))
        self.assertEqual(longer['words'][0]['end'], 20)
        self.song.write_bytes(b'different audio')
        self.assertEqual(self.run_song()['duration'], 20)
        self.assertEqual(self.separations, 3)

    def test_installed_model_set_changes_automatic_cache_identity(self):
        before = self.run_song()
        with mock.patch('karaoke.transcription.installed_models', return_value=(MULTILINGUAL,)):
            after = self.run_song()
        self.assertEqual((before['model'], after['model']), (ENGLISH.name, MULTILINGUAL.name))
        self.assertEqual((self.separations, self.recognitions), (1, 2))

    def test_untrusted_legacy_cache_does_not_override_current_run(self):
        work = self.root / 'work'
        work.mkdir()
        (work / 'transcript.json').write_text(json.dumps(dict(duration=99, model=ENGLISH.name,
             words=[dict(text='stale', start=0, end=99, confidence=1)], seconds=1)))
        self.assertEqual(process(self.song, work, self.root / 'models', self.cap)['duration'], 10)
        self.assertEqual(json.loads((work / 'transcript.json').read_text())['duration'], 99, 'legacy evidence preserved')


if __name__ == '__main__':
    unittest.main()
