"""Independent complete-song and bounded timing regressions from handoff review."""
import time
import unittest

from karaoke.lyrics_auto import align_lines, word_timings, words_to_cues


class HandoffTimingTests(unittest.TestCase):
    def test_complete_ten_minute_words_survive_line_capacity(self):
        words = [dict(text='hello', start=i, end=i + .1, confidence=.9) for i in range(600)]
        cues = words_to_cues(words, 600, confidence=True)
        self.assertLessEqual(len(cues), 200)
        self.assertEqual(sum(len(cue['text'].split()) for cue in cues), 600)
        self.assertGreater(cues[-1]['end'], 599)
        self.assertTrue(all(len(cue['text']) <= 240 for cue in cues))

    def test_fractional_cue_boundaries_admit_every_word_reply(self):
        cue = dict(start=1.0004, end=2, text='One two')
        result = word_timings([cue], [], 3)[0]
        self.assertTrue(all(cue['start'] <= word['start'] <= cue['end'] for word in result))
        self.assertEqual([word['text'] for word in result], ['One', 'two'])

    def test_maximum_alignment_is_bounded_and_preserves_supplied_lines(self):
        lines = [' '.join(['a'] * 50) for _ in range(200)]
        words = [dict(text='b', start=i / 10, end=i / 10 + .05) for i in range(6000)]
        started = time.monotonic()
        cues = align_lines(lines, words, 600)
        elapsed = time.monotonic() - started
        self.assertLess(elapsed, 2, 'Maximum requests must avoid quadratic alignment work.')
        self.assertEqual([cue['text'] for cue in cues], lines)
        self.assertTrue(all(cue['matched'] == 0 for cue in cues))

    def test_unequal_word_lengths_fit_without_refusing_complete_lyrics(self):
        text = ['abcdefghijklmnopqrst'] * 500 + ['a'] * 2500
        words = [dict(text=word, start=i * .2, end=i * .2 + .1) for i, word in enumerate(text)]
        cues = words_to_cues(words, 600)
        self.assertLessEqual(len(cues), 200)
        self.assertEqual(' '.join(cue['text'] for cue in cues).split(), text)

    def test_long_exact_recognition_retains_alignment_without_quadratic_work(self):
        line = 'one two three four five six'
        tokens = (line + ' ') * 200
        words = [dict(text=word, start=i * .4, end=i * .4 + .1) for i, word in enumerate(tokens.split())]
        cues = align_lines([line] * 200, words, 480)
        self.assertEqual(len(cues), 200)
        self.assertTrue(all(cue['matched'] == 1 for cue in cues))
