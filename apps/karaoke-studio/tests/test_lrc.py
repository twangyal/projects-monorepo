import unittest

from karaoke.lrc import render_lrc
from karaoke.model import create_project, update_project


class LrcTests(unittest.TestCase):
    def setUp(self):
        self.project = update_project(create_project('b' * 32, 'Song [live] <demo>', 125.5), 'Song [live] <demo>',
                                      [dict(start=1.0, end=3.0, text='Hello [there] world'),
                                       dict(start=3.0, end=5.25, text='Second\nline'),
                                       dict(start=70.0, end=72.5, text='Last')], 0)

    def test_lines_and_words_are_timed_and_tag_brackets_cannot_inject_timestamps(self):
        lines = render_lrc(self.project).splitlines()
        self.assertEqual(lines[:3], ['[ti:Song (live) (demo)]', '[length:02:05]', '[re:Karaoke Studio]'])
        self.assertTrue(lines[3].startswith('[00:01.00]<00:01.00>Hello <'), lines[3])
        self.assertIn('>(there) <', lines[3])
        # A line that runs straight into the next one has no clearing line between them.
        self.assertTrue(lines[4].startswith('[00:03.00]<00:03.00>Second <'), lines[4])
        self.assertTrue(lines[4].endswith('>line'))
        # A gap before the next line, and the last line, end with an empty timed line.
        self.assertEqual(lines[5], '[00:05.25]')
        self.assertTrue(lines[6].startswith('[01:10.00]<01:10.00>Last'))
        self.assertEqual(lines[7], '[01:12.50]')
        for line in lines[3:]:
            self.assertEqual(line.count('['), 1, line)

    def test_recognized_words_set_word_starts(self):
        words = [dict(text='hello', start=1.2, end=1.5), dict(text='there', start=1.6, end=2.0),
                 dict(text='world', start=2.3, end=2.8)]
        line = render_lrc(self.project, words).splitlines()[3]
        self.assertEqual(line, '[00:01.00]<00:01.20>Hello <00:01.60>(there) <00:02.30>world')


if __name__ == '__main__':
    unittest.main()
