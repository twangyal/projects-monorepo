import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image
from karaoke import video
from karaoke.ass import render_ass
from karaoke.model import ValidationError, create_project, update_project

FONT = Path(__file__).resolve().parents[1] / 'assets' / 'DejaVuSans.ttf'
# What the preview gives for each style and singer (src/parts.ts; see parts.test.ts).
FIXTURE = json.loads((Path(__file__).parent / 'part-colours.json').read_text())
SINGERS = (('anyone', None), ('1', 1), ('2', 2), ('both', 'both'))


def rgb(colour):
    return tuple(int(colour[i:i + 2], 16) for i in (1, 3, 5))


class PartTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.duet = update_project(create_project('d' * 32, 'Duet', 8), 'Duet', [
            dict(start=0, end=2, text='I SING THIS', singer=1), dict(start=2, end=4, text='YOU SING THAT', singer=2),
            dict(start=4, end=6, text='WE SING TOGETHER', singer='both'), dict(start=6, end=8, text='ANYONE')], 0)

    def test_colours_and_labels_match_the_preview(self):
        for style in video.STYLES:
            for key, singer in SINGERS:
                main, accent = video.part_look(style, singer)
                self.assertEqual({'main': main, 'accent': accent}, FIXTURE[style][key], f'{style} {key}')
        for key, singer in SINGERS:
            self.assertEqual(video.next_label(singer), FIXTURE['next'][key])

    def test_lines_keep_their_singer_and_refuse_any_other(self):
        self.assertEqual([cue.get('singer') for cue in self.duet['cues']], [1, 2, 'both', None])
        for bad in (True, 3, 'two', '1', 0, 1.0, 2.0):
            with self.assertRaises(ValidationError, msg=repr(bad)):
                update_project(self.duet, 'Duet', [dict(start=0, end=1, text='x', singer=bad)], self.duet['revision'])

    def test_a_singers_line_lights_in_its_colour_on_the_video_card(self):
        colours = {}
        for index in (0, 1, 2):
            output = self.root / f'line-{index}.png'
            video.render_card(self.duet, index, output, FONT, sung=self.duet['cues'][index]['text'].split())
            with Image.open(output) as image:
                colours[index] = {colour for _, colour in image.convert('RGB').crop((0, 250, 1280, 390)).getcolors(1 << 20)}
        accents = [rgb(video.part_look('classic', singer)[1]) for singer in (1, 2, 'both')]
        for index, accent in enumerate(accents):
            self.assertIn(accent, colours[index], f'line {index + 1}')
            for other in accents:
                if other != accent:
                    self.assertNotIn(other, colours[index], f'line {index + 1}')

    def test_ass_subtitles_give_each_part_a_style_and_name(self):
        ass = render_ass(self.duet)
        self.assertIn('Style: Singer 2,Arial,54,&H00FFC58E,', ass)
        for name in ('Singer 1', 'Singer 2', 'Both'):
            self.assertIn(f'Style: {name},', ass)
        events = [line for line in ass.splitlines() if line.startswith('Dialogue:')]
        self.assertEqual([line.split(',')[3:5] for line in events], [['Singer 1', 'Singer 1'], ['Singer 2', 'Singer 2'], ['Both', 'Both'], ['Karaoke', '']])
        # Lyrics without parts keep the one style.
        solo = update_project(create_project('e' * 32, 'Solo', 3), 'Solo', [dict(start=0, end=2, text='ALONE')], 0)
        self.assertEqual([line for line in render_ass(solo).splitlines() if line.startswith('Style:')], [line for line in ass.splitlines() if line.startswith('Style: Karaoke,')])


if __name__ == '__main__':
    unittest.main()
