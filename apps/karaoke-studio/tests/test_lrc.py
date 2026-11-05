import unittest

from karaoke.lrc import render_lrc
from karaoke.model import ValidationError, create_project, update_project


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

    def test_words_of_spaceless_scripts_are_stamped_without_spaces(self):
        project = update_project(create_project('c' * 32, 'Song', 20.0), 'Song', [dict(start=1.0, end=4.0, text='我爱你 love')], 0)
        words = [dict(text=character, start=1.2 + 0.5 * index, end=1.5 + 0.5 * index) for index, character in enumerate('我爱你')]
        self.assertEqual(render_lrc(project, words).splitlines()[3],
                         '[00:01.00]<00:01.20>我<00:01.70>爱<00:02.20>你 <00:02.61>love')

    def test_short_cues_and_gaps_keep_millisecond_boundaries(self):
        project = update_project(create_project('d' * 32, 'Short', 4.008), 'Short',
                                 [dict(start=1.001, end=1.003, text='One'),
                                  dict(start=1.004, end=1.006, text='Two'),
                                  dict(start=4.001, end=4.008, text='Last')], 0)
        self.assertEqual(render_lrc(project).splitlines()[3:],
                         ['[00:01.001]<00:01.001>One', '[00:01.003]',
                          '[00:01.004]<00:01.004>Two', '[00:01.006]',
                          '[00:04.001]<00:04.001>Last', '[00:04.008]'])

    def test_final_clear_does_not_round_past_fractional_clip_end(self):
        project = update_project(create_project('d' * 32, 'End', 4.0088), 'End',
                                 [dict(start=4.001, end=4.0088, text='Last')], 0)
        self.assertEqual(render_lrc(project).splitlines()[-1], '[00:04.008]')

    def test_exact_millisecond_clip_end_is_not_floored_one_tick_early(self):
        project = update_project(create_project('d' * 32, 'End', 1.001), 'End',
                                 [dict(start=1.0, end=1.001, text='Last')], 0)
        self.assertEqual(render_lrc(project).splitlines()[-1], '[00:01.001]')

    def test_half_millisecond_ties_do_not_collapse_a_millisecond_line(self):
        for start, end, stamps in [(1.0015, 1.0025, ('01.002', '01.003')),
                                   (2.0025, 2.0035, ('02.003', '02.004'))]:
            with self.subTest(start=start):
                project = update_project(create_project('d' * 32, 'Ties', 4.0), 'Ties',
                                         [dict(start=start, end=end, text='Short')], 0)
                first, last = stamps
                self.assertEqual(render_lrc(project).splitlines()[3:],
                                 [f'[00:{first}]<00:{first}>Short', f'[00:{last}]'])

    def test_unrepresentable_interval_refuses_instead_of_emitting_duplicate_stamps(self):
        project = update_project(create_project('d' * 32, 'Short', 4.0), 'Short',
                                 [dict(start=1.0001, end=1.0002, text='Short')], 0)
        with self.assertRaisesRegex(ValidationError, 'Lyric line 1.*millisecond'):
            render_lrc(project)


if __name__ == '__main__':
    unittest.main()
