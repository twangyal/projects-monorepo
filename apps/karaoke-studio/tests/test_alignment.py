"""Forced alignment of supplied lyrics to stored letter probabilities (numpy only, no model)."""
from pathlib import Path
import tempfile
import unittest

import numpy as np

from karaoke.alignment import (
    BLANK, CLASSES, FRAME, LETTERS, SPACE, _path, alignable, fold, force_align, max_bytes, read_emissions, word_letters, write_emissions,
)
from karaoke.lyrics_auto import LEAD_IN


def plain_path(log_probs, tokens):
    """Textbook CTC Viterbi with a full back-pointer table, to check the memory-bounded one."""
    frames, states = log_probs.shape[0], 2 * len(tokens) + 1
    labels = np.full(states, BLANK)
    labels[1::2] = tokens
    skip = np.zeros(states, bool)
    if len(tokens) > 1:
        skip[3::2] = np.array(tokens[1:]) != np.array(tokens[:-1])
    floor = -1e30
    score = np.full(states, floor)
    score[0], score[1] = log_probs[0, BLANK], log_probs[0, labels[1]]
    back = np.zeros((frames, states), np.int64)
    for t in range(1, frames):
        step1 = np.concatenate([[floor], score[:-1]])
        step2 = np.where(skip, np.concatenate([[floor, floor], score[:-2]]), floor)
        best = np.maximum(score, np.maximum(step1, step2))
        back[t] = np.where(best == score, 0, np.where(best == step1, 1, 2))
        score = best + log_probs[t, labels]
    state = states - 1 if score[states - 1] >= score[states - 2] else states - 2
    first = np.full(len(tokens), -1)
    for t in range(frames - 1, -1, -1):
        if state % 2 == 1:
            first[state // 2] = t
        state -= back[t, state]
    return first


def sung(lines_at, seconds, letter_frames=3, language=None):
    """Letter probabilities for lyrics sung at the given times: each letter clear for a few frames, blank elsewhere."""
    frames = int(round(seconds / FRAME))
    probs = np.full((frames, CLASSES), 1e-4)
    probs[:, BLANK] = 1.0
    for text, start in lines_at:
        t = int(round(start / FRAME))
        for letters in word_letters(text, language):
            for ch in letters:
                probs[t:t + letter_frames, :] = 1e-4
                probs[t:t + letter_frames, LETTERS[ch]] = 1.0
                t += letter_frames + 1
            probs[t:t + 2, :] = 1e-4
            probs[t:t + 2, SPACE] = 1.0
            t += 4
    probs /= probs.sum(axis=1, keepdims=True)
    return np.log(probs).astype(np.float32)


class PathTests(unittest.TestCase):
    def test_the_memory_bounded_path_matches_the_textbook_one(self):
        rng = np.random.default_rng(7)
        for frames, letters in [(40, 5), (97, 20), (400, 60), (1000, 120)]:
            logits = rng.normal(size=(frames, CLASSES)).astype(np.float32) * 3
            log_probs = logits - np.log(np.exp(logits).sum(axis=1, keepdims=True))
            # Repeated letters need a blank between them, which exercises the skip rule.
            tokens = [int(v) for v in rng.integers(5, CLASSES, size=letters)]
            tokens[1] = tokens[0]
            first, peak = _path(log_probs, tokens)
            np.testing.assert_array_equal(first, plain_path(log_probs, tokens))
            self.assertTrue(np.all(np.diff(first) >= 0))
            self.assertTrue(((peak > 0) & (peak <= 1)).all())


class ForcedAlignmentTests(unittest.TestCase):
    def test_lines_start_where_their_letters_are_sung_even_after_long_gaps(self):
        sung_at = [('Hello darkness my old friend', 2.0), ("I've come to talk with you again", 9.5), ('Because a vision softly creeping', 31.0)]
        cues = force_align([text for text, _ in sung_at], sung(sung_at, 45), 45)
        self.assertEqual([cue['text'] for cue in cues], [text for text, _ in sung_at])
        for cue, (_, start) in zip(cues, sung_at, strict=True):
            self.assertAlmostEqual(cue['start'] + LEAD_IN, start, delta=0.05)
            self.assertGreater(cue['matched'], 0.9)
        self.assertTrue(all(a['end'] <= b['start'] for a, b in zip(cues, cues[1:])))

    def test_accents_fold_and_lines_never_sung_are_reported_unsure(self):
        lines = ['Où est la fête ce soir', 'Straße und Mädchen', 'nobody sings this line here']
        log_probs = sung([(lines[0], 1.0), (lines[1], 6.0)], 20)
        cues = force_align(lines, log_probs, 20)
        self.assertAlmostEqual(cues[0]['start'] + LEAD_IN, 1.0, delta=0.05)
        self.assertAlmostEqual(cues[1]['start'] + LEAD_IN, 6.0, delta=0.05)
        self.assertGreater(cues[1]['matched'], 0.9)
        self.assertLess(cues[2]['matched'], 0.5)

    def test_lyrics_that_cannot_be_laid_on_the_frames_are_left_to_the_fallback(self):
        log_probs = sung([('la la', 0.5)], 2)
        self.assertIsNone(force_align(['东京的夜'], log_probs, 2))
        self.assertIsNone(force_align(['a much longer line than two seconds of singing could ever hold ' * 3], log_probs, 2))
        self.assertIsNone(force_align([], log_probs, 2))
        # A line of numbers only sits between its neighbours.
        cues = force_align(['la la', '1 2 3', 'la la'], sung([('la la', 0.5), ('la la', 6.0)], 10), 10)
        self.assertEqual(len(cues), 3)
        self.assertLessEqual(cues[0]['end'], cues[1]['start'])
        self.assertLessEqual(cues[1]['end'], cues[2]['start'])

    def test_lyrics_in_latin_letters_or_korean_are_aligned(self):
        self.assertEqual(fold("Où l'été, Straße! Æsir"), "OUL'ETESTRASSEAESIR")
        self.assertTrue(alignable(['Mädchen und Straße', 'ça va, señor']))
        self.assertFalse(alignable(['東京の夜', 'Tokyo']))
        self.assertFalse(alignable(['', '123 !!']))
        # Korean is spelled syllable by syllable in Revised Romanization; lines mixing it with English are aligned too.
        self.assertEqual(fold('사랑해'), 'SARANGHAE')
        self.assertEqual(fold('어떻게 닭'), 'EOTTEOTGEDAK')
        self.assertEqual(fold('꽃잎, 빛!'), 'KKOTIPBIT')
        self.assertTrue(alignable(['사랑해 baby', '너를 보면']))
        self.assertFalse(alignable(['사랑해 東京の夜です']))
        # Cyrillic is transliterated as Russian reads it, with Ukrainian and Serbian letters too; its signs are silent.
        self.assertEqual(fold('Берегов Москвы'), 'BEREGOVMOSKVY')
        self.assertEqual(fold('Забудьте всё, щит'), 'ZABUDTEVSYOSHCHIT')
        self.assertEqual(fold('їжак ґанок љубав'), 'YIZHAKGANOKLJUBAV')
        self.assertTrue(alignable(['Забудьте всё что было вчера', 'oh baby, давай']))

    def test_chinese_is_read_in_pinyin_only_in_a_song_recognized_as_mandarin(self):
        # Each character is a lyric word, read with its phrase: 乐 is "yue" in 音乐 (music) and "le" in 快乐 (happy).
        self.assertEqual(word_letters('我爱你', 'zh'), ['WO', 'AI', 'NI'])
        self.assertEqual(word_letters('音乐 快乐', 'zh'), ['YIN', 'YUE', 'KUAI', 'LE'])
        self.assertEqual(word_letters('绿色', 'zh'), ['LV', 'SE'])
        # Without the song's language the characters are not read: they could be sung in Cantonese.
        self.assertEqual(word_letters('我爱你'), ['', '', ''])
        self.assertTrue(alignable(['我爱你 baby', '月亮代表我的心'], 'zh'))
        for language in (None, 'yue', 'ja'):
            self.assertFalse(alignable(['我爱你', '月亮代表我的心'], language), language)
        # Japanese kana are never read, so Japanese lyrics stay with recognized words even in pinyin's reach.
        self.assertFalse(alignable(['東京の夜です'], 'zh'))

    def test_mandarin_lines_start_where_their_pinyin_is_sung(self):
        sung_at = [('月亮代表我的心', 1.5), ('你问我爱你有多深', 9.0), ('我爱你有几分', 17.0)]
        log_probs = sung(sung_at, 26, language='zh')
        cues = force_align([text for text, _ in sung_at], log_probs, 26, 'zh')
        self.assertEqual([cue['text'] for cue in cues], [text for text, _ in sung_at])
        for cue, (_, start) in zip(cues, sung_at, strict=True):
            self.assertAlmostEqual(cue['start'] + LEAD_IN, start, delta=0.05)
            self.assertGreater(cue['matched'], 0.9)
        self.assertIsNone(force_align([text for text, _ in sung_at], log_probs, 26))

    def test_russian_lines_start_where_their_transliterated_letters_are_sung(self):
        sung_at = [('Анна Каренина, Анна Вронская', 1.5), ('Где теперь она, та моя', 8.0), ('На долгожданную войну', 14.0)]
        cues = force_align([text for text, _ in sung_at], sung(sung_at, 22), 22)
        self.assertEqual([cue['text'] for cue in cues], [text for text, _ in sung_at])
        for cue, (_, start) in zip(cues, sung_at, strict=True):
            self.assertAlmostEqual(cue['start'] + LEAD_IN, start, delta=0.05)
            self.assertGreater(cue['matched'], 0.9)

    def test_korean_lines_start_where_their_romanized_letters_are_sung(self):
        sung_at = [('보고 싶어 너를', 1.5), ('oh baby 사랑해', 8.0), ('다시 만나', 15.0)]
        cues = force_align([text for text, _ in sung_at], sung(sung_at, 25), 25)
        self.assertEqual([cue['text'] for cue in cues], [text for text, _ in sung_at])
        for cue, (_, start) in zip(cues, sung_at, strict=True):
            self.assertAlmostEqual(cue['start'] + LEAD_IN, start, delta=0.05)
            self.assertGreater(cue['matched'], 0.9)


class StoredEmissionTests(unittest.TestCase):
    def test_letter_probabilities_round_trip_and_must_match_their_clip(self):
        log_probs = sung([('stored line', 0.2)], 3)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'alignment.bin'
            write_emissions(path, log_probs)
            raw = path.read_bytes()
        self.assertLessEqual(len(raw), max_bytes(3))
        np.testing.assert_allclose(read_emissions(raw, 3), log_probs, atol=0.01)
        for broken, duration in [(raw, 4.0), (raw[:-2], 3.0), (b'XXXXXXXX' + raw[8:], 3.0), (raw[:6], 3.0)]:
            with self.assertRaises(ValueError):
                read_emissions(broken, duration)
        positive = np.array(log_probs)
        positive[0, 0] = 2.0
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'alignment.bin'
            write_emissions(path, positive)
            with self.assertRaises(ValueError):
                read_emissions(path.read_bytes(), 3)
            with self.assertRaises(FileExistsError):
                path.with_name('alignment.bin.part').touch()
                write_emissions(path, log_probs)


if __name__ == '__main__':
    unittest.main()


class TranscriptionMeasuresLettersTests(unittest.TestCase):
    """Recognition is followed by the aligner when it is installed; the aligner never costs the transcript."""

    def run_transcription(self, aligner):
        import json
        import threading
        from unittest import mock
        from karaoke import transcription
        from tests.test_lyrics_auto import SUNG
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root, commands = Path(directory.name), []
        output = root / 'transcript.json'

        def run(args, *_args, **_kwargs):
            commands.append(Path(args[1]).name)
            if args[1].endswith('transcribe_worker.py'):
                output.write_text(json.dumps(dict(model=transcription.ENGLISH.name, words=SUNG, seconds=0.1)))
            else:
                aligner(Path(args[args.index('--output') + 1]))
        with mock.patch.object(transcription, 'installed_models', return_value=(transcription.ENGLISH,)), \
                mock.patch.object(transcription, 'aligner_ready', return_value=True), mock.patch.object(transcription, '_run', run):
            try:
                result = transcription.transcribe_vocals(root / 'vocals.wav', output, root, 40, threading.Event(), lambda _: None)
            except RuntimeError as error:
                result = error
        return result, commands, root

    def test_the_aligner_runs_after_recognition_and_its_failure_keeps_the_transcript(self):
        result, commands, root = self.run_transcription(lambda path: write_emissions(path, sung([('la', 1.0)], 40)))
        self.assertEqual(commands, ['transcribe_worker.py', 'align_worker.py'])
        self.assertEqual(result['model'], 'parakeet-tdt-0.6b-v2-int8+silero-vad')
        self.assertEqual(read_emissions((root / 'alignment.bin').read_bytes(), 40).shape, (2000, CLASSES))

        def broken(path):
            path.with_name(path.name + '.part').write_bytes(b'half')
            raise RuntimeError('aligner crashed')
        result, commands, root = self.run_transcription(broken)
        self.assertEqual(result['model'], 'parakeet-tdt-0.6b-v2-int8+silero-vad')
        self.assertEqual(sorted(p.name for p in root.iterdir()), ['transcript.json'])


class ServerAlignmentTests(unittest.TestCase):
    """Supplied lyrics through HTTP: laid on the measured letters when the clip has them, else on recognized words."""

    def setUp(self):
        import json
        from tests.test_lyrics_auto import SUNG, silent_separation
        from tests.test_server import ServerTests
        from karaoke.transcription import ENGLISH
        self.measure, self.language = True, None

        def transcribe(vocals, output, model_root, duration, cancel, stage):
            transcript = dict(model=ENGLISH.name, words=SUNG, seconds=0.1, **({'language': self.language} if self.language else {}))
            Path(output).write_text(json.dumps(transcript))
            if self.measure:
                # The singing is a second and a half earlier than the recognized words say.
                write_emissions(Path(output).with_name('alignment.bin'), sung([('Lay awake at night', 17.0), ('through all the pain', 28.6), ('tonight we sing', 35.0)], duration))
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
        self.server = self.helper.start_server(separate=silent_separation, transcribe=transcribe, transcriber_ready=lambda _root: True)
        self.helper.server = self.server
        self.helper.token = self.helper.request('GET', '/api/session')[2]['token']

    def align(self, base, lines):
        status, _, reply = self.helper.request('POST', base + '/align', {'lines': lines})
        self.assertEqual(status, 200, reply)
        return [round(cue['start'], 2) for cue in reply['cues']]

    def test_chinese_lyrics_are_laid_on_the_singing_only_in_a_song_recognized_as_mandarin(self):
        from unittest import mock
        from karaoke.alignment import force_align as real
        self.language = 'zh'
        self.assertEqual(self.helper.upload()['status'], 'complete')
        project = self.helper.request('GET', '/api/projects')[2]['projects'][0]
        base = f'/api/projects/{project["id"]}'
        with mock.patch('karaoke.server.force_align', wraps=real) as forced:
            self.assertEqual(len(self.align(base, ['月亮代表我的心', '我爱你'])), 2)
            self.assertEqual(forced.call_args.args[3], 'zh')
        # The word timings sent to the preview, and the exports, are read the same way.
        status, _, reply = self.helper.request('POST', base + '/word-timings', {'cues': [{'start': 17.0, 'end': 20.0, 'text': '我爱你'}]})
        self.assertEqual(status, 200, reply)
        self.assertEqual(len(reply['lines'][0]), 3)

    def test_japanese_lyrics_are_laid_on_the_singing_with_the_reading_dictionary(self):
        from unittest import mock
        from karaoke.alignment import force_align as real
        from tests.test_japanese import DICTIONARY
        self.language = 'ja'
        self.assertEqual(self.helper.upload()['status'], 'complete')
        project = self.helper.request('GET', '/api/projects')[2]['projects'][0]
        base = f'/api/projects/{project["id"]}'
        with DICTIONARY, mock.patch('karaoke.server.force_align', wraps=real) as forced:
            self.assertEqual(len(self.align(base, ['出して輝き続けよ', '君の名は'])), 2)
            self.assertEqual(forced.call_args.args[3], 'ja')
        # Without the dictionary they are matched to the recognized words, as before.
        with mock.patch('karaoke.japanese._dictionary', return_value=None), mock.patch('karaoke.server.force_align') as forced:
            self.align(base, ['出して輝き続けよ', '君の名は'])
            forced.assert_not_called()

    def test_supplied_lyrics_are_laid_on_the_singing_and_fall_back_to_recognized_words(self):
        from unittest import mock
        self.assertEqual(self.helper.upload()['status'], 'complete')
        project = self.helper.request('GET', '/api/projects')[2]['projects'][0]
        base, folder = f'/api/projects/{project["id"]}', self.server.projects_dir / project['id']
        self.assertTrue((folder / 'alignment.bin').is_file())
        lines = ['Lay awake at night', 'through all the pain']
        self.assertEqual(self.align(base, lines), [16.85, 28.45])
        # Lyrics in another script are matched to recognized words; Korean is spelled in Latin letters and laid on them.
        with mock.patch('karaoke.server.force_align') as forced:
            self.align(base, ['夜に目覚めて', '痛みを越えて'])
            forced.assert_not_called()
        with mock.patch('karaoke.server.force_align', wraps=force_align) as forced:
            self.assertEqual(len(self.align(base, ['사랑해 너를', '보고 싶어'])), 2)
            forced.assert_called_once()
        # Unreadable measurements are ignored rather than refused.
        good = (folder / 'alignment.bin').read_bytes()
        (folder / 'alignment.bin').write_bytes(good[:-64])
        self.assertEqual(self.align(base, lines), [18.35, 29.95])
        (folder / 'alignment.bin').unlink()
        self.assertEqual(self.align(base, lines), [18.35, 29.95])
        # Transcribing again measures the letters anew; a pass without the aligner keeps what was measured.
        for measure in (True, False):
            self.measure = measure
            status, _, started = self.helper.request('POST', base + '/transcribe', {})
            self.assertEqual(status, 202, started)
            self.assertEqual(self.helper.wait_job(started['job']['id'])['status'], 'complete')
            self.assertEqual((folder / 'alignment.bin').read_bytes(), good)
            self.assertEqual(self.align(base, lines), [16.85, 28.45])


    def test_word_highlighting_lrc_and_video_take_word_times_from_the_letters(self):
        self.assertEqual(self.helper.upload()['status'], 'complete')
        project = self.helper.request('GET', '/api/projects')[2]['projects'][0]
        base = f'/api/projects/{project["id"]}'
        status, _, timed = self.helper.request('POST', base + '/word-timings', {'cues': [{'start': 34.8, 'end': 38.5, 'text': 'tonight we sing'}]})
        self.assertEqual(status, 200, timed)
        words = timed['lines'][0]
        self.assertEqual([word['heard'] for word in words], [False, False, False])
        self.assertAlmostEqual(words[0]['start'], 35.0, delta=0.05)
        self.assertAlmostEqual(words[1]['start'], 35.0 + 7 * 4 * FRAME + 4 * FRAME, delta=0.05)
        # Saved, the same times reach the word-timed LRC, and the video export is given the letters.
        status, _, saved = self.helper.request('PUT', base, {'title': 'Song', 'revision': project['revision'],
                                                            'cues': [{'start': 34.8, 'end': 38.5, 'text': 'tonight we sing'}]})
        self.assertEqual(status, 200, saved)
        status, _, lrc = self.helper.request('GET', base + '/lrc')
        self.assertIn('<00:35.00>tonight', lrc if isinstance(lrc, str) else lrc.decode())
        exported = []
        self.server.export = lambda *args, **options: (exported.append(options), Path(args[2]).write_bytes(b'video'))
        status, _, started = self.helper.request('POST', base + '/export', {})
        self.assertEqual(status, 202, started)
        self.assertEqual(self.helper.wait_job(started['job']['id'])['status'], 'complete')
        self.assertEqual(exported[0]['letters'].shape[1], CLASSES)


class WordHighlightTests(unittest.TestCase):
    """Words start where their letters were sung."""

    def test_words_start_where_their_letters_are_sung_within_a_line(self):
        from karaoke.alignment import force_words
        log_probs = sung([('so many words to sing', 4.0)], 12)
        starts = force_words('so many words to sing', log_probs, 3.9, 9.0)
        # Each letter lasts 3 frames plus a gap, each word a further 4 frames.
        expected, t = [], 4.0
        for word in 'so many words to sing'.split():
            expected.append(t)
            t += len(word) * 4 * FRAME + 4 * FRAME
        for got, want in zip(starts, expected, strict=True):
            self.assertAlmostEqual(got, want, delta=0.03)
        self.assertIsNone(force_words('東京', log_probs, 3.9, 9.0))
        # Russian words start where their transliterated letters were sung.
        russian = sung([('что было вчера', 2.0)], 8)
        expected, t = [], 2.0
        for word in 'что было вчера'.split():
            expected.append(t)
            t += len(fold(word)) * 4 * FRAME + 4 * FRAME
        for got, want in zip(force_words('что было вчера', russian, 1.9, 6.0), expected, strict=True):
            self.assertAlmostEqual(got, want, delta=0.03)
        # Korean words, too, start where their letters were sung.
        korean = sung([('너를 보면 웃어', 2.0)], 8)
        expected, t = [], 2.0
        for word in '너를 보면 웃어'.split():
            expected.append(t)
            t += len(fold(word)) * 4 * FRAME + 4 * FRAME
        for got, want in zip(force_words('너를 보면 웃어', korean, 1.9, 6.0), expected, strict=True):
            self.assertAlmostEqual(got, want, delta=0.03)
        # Numbers start between their neighbours.
        self.assertEqual(len(force_words('so 2 many', sung([('so many', 1.0)], 4), 0.9, 3.0)), 3)

    def test_highlighting_lays_every_word_on_the_letters(self):
        from karaoke.lyrics_auto import word_timings
        log_probs = sung([('lay awake at night', 18.0)], 40)
        cue = dict(start=17.8, end=21.5, text='lay awake at night')
        heard = [dict(text='Lay', start=18.15, end=18.4, confidence=0.9)]
        timings = word_timings([cue], heard, 40, log_probs)[0]
        # A heard word, too, starts where its letters were sung rather than where recognition placed it.
        self.assertAlmostEqual(timings[0]['start'], 18.0, delta=0.03)
        self.assertTrue(timings[0]['heard'])
        self.assertAlmostEqual(timings[1]['start'], 18.0 + 3 * 4 * FRAME + 4 * FRAME, delta=0.05)
        self.assertEqual([word['start'] for word in timings], sorted(word['start'] for word in timings))
        # Without letters, unheard words are spread by length as before.
        before = word_timings([cue], heard, 40)[0]
        self.assertNotAlmostEqual(before[1]['start'], timings[1]['start'], delta=0.05)
        # A line in a script the aligner cannot spell keeps the spread.
        other = dict(start=17.8, end=21.5, text='夜 に 目覚めて')
        self.assertEqual(word_timings([other], [], 40, log_probs), word_timings([other], [], 40))

    def test_mandarin_characters_highlight_where_their_pinyin_is_sung(self):
        from karaoke.lyrics_auto import word_timings
        log_probs = sung([('我爱你', 4.0)], 10, language='zh')
        cue = dict(start=3.8, end=6.5, text='我爱你')
        timings = word_timings([cue], [], 10, log_probs, 'zh')[0]
        # Each letter lasts 4 frames and each word 4 more: WO, AI and NI start 0.24 s apart.
        for word, want in zip(timings, [4.0, 4.24, 4.48], strict=True):
            self.assertAlmostEqual(word['start'], want, delta=0.03)
        # Read as Cantonese (or in an older transcript without a language) the characters are spread as before.
        self.assertEqual(word_timings([cue], [], 10, log_probs, 'yue'), word_timings([cue], [], 10))
