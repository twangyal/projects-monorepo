import re
import unittest

from karaoke.ass import render_ass
from karaoke.model import create_project, update_project


def dialogue(text: str) -> list[str]:
    return [line for line in text.splitlines() if line.startswith('Dialogue:')]


class AssTests(unittest.TestCase):
    def setUp(self):
        self.project = update_project(create_project('d' * 32, 'Song {live} \\demo', 125.5), 'Song {live} \\demo',
                                      [dict(start=1.0, end=3.0, text='Hello {there} world'),
                                       dict(start=70.0, end=72.5, text='Last')], 0)

    def test_header_style_and_one_event_per_line(self):
        text = render_ass(self.project)
        self.assertIn('[Script Info]', text)
        self.assertIn('Title: Song (live) /demo', text)
        self.assertIn('ScriptType: v4.00+', text)
        # Sung words fill with the video's accent colour (#e4b77d) over its main colour (#f7f5ed), as BGR.
        self.assertIn('Style: Karaoke,Arial,54,&H007DB7E4,&H00EDF5F7,', text)
        events = dialogue(text)
        self.assertEqual(len(events), 2)
        self.assertTrue(events[0].startswith('Dialogue: 0,0:00:01.00,0:00:03.00,Karaoke,,0,0,0,,'), events[0])
        self.assertTrue(events[1].startswith('Dialogue: 0,0:01:10.00,0:01:12.50,Karaoke,,0,0,0,,'), events[1])

    def test_words_fill_as_sung_and_lyrics_cannot_open_override_blocks(self):
        words = [dict(text='hello', start=1.2, end=1.5), dict(text='there', start=1.6, end=2.0), dict(text='world', start=2.3, end=2.8)]
        line = dialogue(render_ass(self.project, words))[0].split(',,', 1)[1].split(',', 4)[-1]
        # The wait before the first word is an empty \k; each word fills until the next starts, the last until the line ends.
        self.assertEqual(line, '{\\k20}{\\kf40}Hello {\\kf70}(there) {\\kf70}world')
        tags = [int(value) for value in re.findall(r'\\kf?(\d+)', line)]
        self.assertEqual(sum(tags), 200, 'the tags fill the line from its start to its end')
        self.assertNotIn('{there}', line)

    def test_words_of_spaceless_scripts_have_no_spaces(self):
        project = update_project(create_project('e' * 32, 'Song', 20.0), 'Song', [dict(start=1.0, end=4.0, text='我爱你')], 0)
        words = [dict(text=character, start=1.0 + 0.5 * index, end=1.4 + 0.5 * index) for index, character in enumerate('我爱你')]
        self.assertTrue(dialogue(render_ass(project, words))[0].endswith(',,{\\kf50}我{\\kf50}爱{\\kf200}你'))


if __name__ == '__main__':
    unittest.main()
