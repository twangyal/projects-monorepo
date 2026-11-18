"""Word starts set by hand: kept with the line, used by every word highlight, and refused when they do not fit."""
import unittest

from karaoke.ass import render_ass
from karaoke.lrc import render_lrc
from karaoke.lyrics_auto import word_timings
from karaoke.model import ValidationError, create_project, update_project, validate_project

# Recognized words that would place the line's words elsewhere.
HEARD = [dict(text='hello', start=1.0, end=1.4, confidence=0.9), dict(text='there', start=1.5, end=1.9, confidence=0.9),
         dict(text='world', start=2.0, end=2.6, confidence=0.9)]


class WordStartTests(unittest.TestCase):
    def setUp(self):
        self.project = update_project(create_project('e' * 32, 'Words', 10), 'Words', [
            dict(start=1.0, end=4.0, text='hello there world', wordStarts=[1.2, 2.25, 3.5]), dict(start=5.0, end=7.0, text='no hand times')], 0)

    def test_a_line_keeps_its_hand_set_starts_and_others_none(self):
        self.assertEqual(self.project['cues'][0]['wordStarts'], [1.2, 2.25, 3.5])
        self.assertNotIn('wordStarts', self.project['cues'][1])
        # Saved and read back unchanged, integers included.
        again = validate_project({**self.project, 'cues': [{**self.project['cues'][0], 'wordStarts': [1, 2.25, 4]}]})
        self.assertEqual(again['cues'][0]['wordStarts'], [1.0, 2.25, 4.0])

    def test_hand_set_starts_win_over_recognized_and_spread_words(self):
        lines = word_timings(self.project['cues'], HEARD, 10)
        self.assertEqual([(word['text'], word['start'], word['heard']) for word in lines[0]], [('hello', 1.2, True), ('there', 2.25, True), ('world', 3.5, True)])
        # The other line is timed as before.
        self.assertEqual([word['text'] for word in lines[1]], ['no', 'hand', 'times'])
        self.assertFalse(any(word['heard'] for word in lines[1]))

    def test_exports_light_the_words_at_the_hand_set_times(self):
        lrc = render_lrc(self.project, HEARD)
        self.assertIn('[00:01.00]<00:01.20>hello <00:02.25>there <00:03.50>world', lrc)
        ass = render_ass(self.project, HEARD)
        # Karaoke timing in centiseconds: 0.2 s lead-in, then 105 and 125 for "hello" and "there" until the next word.
        self.assertRegex(ass, r'\{\\k20\}\{\\kf105\}hello \{\\kf125\}there \{\\kf\d+\}world')

    def test_starts_that_do_not_fit_the_line_are_refused(self):
        for bad, why in (([1.2, 2.25], 'one start for each word'), ([1.2, 3.5, 2.25], 'in order inside the line'), ([0.5, 2.0, 3.0], 'in order inside the line'),
                         ([1.2, 2.0, 4.5], 'in order inside the line'), ('1.2 2 3', 'one start for each word'), ([1.2, None, 3.0], 'finite number'),
                         ([1.2, True, 3.0], 'finite number'), ([1.2, float('inf'), 3.0], 'finite number')):
            with self.assertRaisesRegex(ValidationError, why, msg=repr(bad)):
                update_project(self.project, 'Words', [dict(start=1.0, end=4.0, text='hello there world', wordStarts=bad)], self.project['revision'])


if __name__ == '__main__':
    unittest.main()
