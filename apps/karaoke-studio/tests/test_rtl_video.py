"""Compare exported lyric pixels with independently shaped whole-line text: lines with right-to-left text are drawn
whole, each pixel in the colour of words sung or not yet sung."""
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
import wave

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageStat
from karaoke.model import create_project, update_project
from karaoke import video

FONT = Path(__file__).resolve().parents[1] / 'assets' / 'DejaVuSans.ttf'


def whole_line(text, direction, font, baseline, fill):
    """The line drawn whole in one colour, as an independent reference."""
    image = Image.new('RGB', (1280, 720), video.BACKGROUND)
    ImageDraw.Draw(image).text((640, baseline), text, font=font, fill=fill, anchor='ms', direction=direction)
    return image


def changed(first, second):
    """A mask of the pixels where two images differ in any channel."""
    bands = ImageChops.difference(first, second).split()
    mask = bands[0]
    for band in bands[1:]:
        mask = ImageChops.lighter(mask, band)
    return mask.point(lambda value: 255 if value else 0)


def word_columns(unsung, sung, top, bottom, gap=14):
    """The columns of each word's ink between ``top`` and ``bottom``, left to right: runs of columns where the two whole
    drawings differ, joined across gaps narrower than the space between words."""
    ink = changed(unsung, sung).crop((0, top, unsung.width, bottom))
    columns = [x for x in range(ink.width) if ink.crop((x, 0, x + 1, ink.height)).getbbox()]
    runs = []
    for column in columns:
        if runs and column - runs[-1][1] < gap:
            runs[-1][1] = column
        else:
            runs.append([column, column])
    return [tuple(run) for run in runs]


class RtlVideoTests(unittest.TestCase):
    def setUp(self):
        video._fonts.cache_clear()
        self.addCleanup(video._fonts.cache_clear)

    def test_layout_matches_preview_behavior_fixture(self):
        import json
        cases = json.loads((Path(__file__).parent / 'text-direction.json').read_text())
        for text, direction, whole_line in cases:
            self.assertEqual(video.text_layout(text), (direction, whole_line), text)

    def test_sung_words_light_where_the_line_shows_them_and_the_line_stays_shaped_whole(self):
        # Each case: the line, its base direction, and its words from left to right as drawn (logical indices).
        cases = [('مرحبا بالعالم', 'rtl', [1, 0]), ('שלום עולם 123', 'rtl', [2, 1, 0]),
                 ('Sing مرحبا 123 now!', 'ltr', [0, 2, 1, 3]), ('مرحبا hello 123', 'rtl', [1, 2, 0]),
                 ('אני אוהב you baby', 'rtl', [2, 3, 1, 0])]
        font = ImageFont.truetype(str(FONT), 44)
        ascent, descent = font.getmetrics()
        for text, direction, order in cases:
            words = text.split()
            unsung, sung = (whole_line(text, direction, font, 320 + (ascent - descent) / 2, fill) for fill in (video.MAIN, video.ACCENT))
            columns = word_columns(unsung, sung, 220, 420)
            self.assertEqual(len(columns), len(words), text)
            for count in range(len(words) + 1):
                with self.subTest(text=text, sung=count):
                    actual = Image.new('RGB', unsung.size, video.BACKGROUND)
                    video._center_text(actual, text, 320, FONT, 44, 24, 300, video.MAIN, sum(map(len, words[:count])))
                    # Every pixel is the whole line drawn in one colour or the other: nothing is split or reshaped.
                    self.assertIsNone(ImageChops.multiply(changed(actual, unsung), changed(actual, sung)).getbbox())
                    # The words already sung, and only they, are in the sung colour, wherever the line shows them.
                    for (low, high), word in zip(columns, order, strict=True):
                        box = (low, 220, high + 1, 420)
                        reference = sung if word < count else unsung
                        self.assertIsNone(changed(actual.crop(box), reference.crop(box)).getbbox(), (word, count))

    def test_a_wrapped_rtl_line_lights_its_rows_in_order(self):
        text = ' '.join(['مرحبا'] * 20)
        font = ImageFont.truetype(str(FONT), 44)
        ascent, descent = font.getmetrics()
        rows = [' '.join(['مرحبا'] * count) for count in (8, 8, 4)]
        baselines = [265 + index * 55 + (ascent - descent) / 2 for index in range(3)]
        unsung, sung = (Image.new('RGB', (1280, 720), video.BACKGROUND) for _ in range(2))
        for image, fill in ((unsung, video.MAIN), (sung, video.ACCENT)):
            for row, baseline in zip(rows, baselines, strict=True):
                ImageDraw.Draw(image).text((640, baseline), row, font=font, fill=fill, anchor='ms', direction='rtl')
        actual = Image.new('RGB', (1280, 720), video.BACKGROUND)
        video._center_text(actual, text, 320, FONT, 44, 24, 300, video.MAIN, 10 * 5)
        self.assertIsNone(ImageChops.multiply(changed(actual, unsung), changed(actual, sung)).getbbox())
        # Ten words sung: all of the first row, the two rightmost words of the second, none of the third.
        for index, lit in enumerate(([True] * 8, [False] * 6 + [True] * 2, [False] * 4)):
            top = round(baselines[index] - 40)
            columns = word_columns(unsung, sung, top, top + 50)
            self.assertEqual(len(columns), len(lit))
            for (low, high), on in zip(columns, lit, strict=True):
                box = (low, top, high + 1, top + 50)
                self.assertIsNone(changed(actual.crop(box), (sung if on else unsung).crop(box)).getbbox(), (index, low))

    def test_without_the_word_order_a_line_lights_whole_once_sung(self):
        from unittest.mock import patch
        font = ImageFont.truetype(str(FONT), 44)
        ascent, descent = font.getmetrics()
        expected = whole_line('مرحبا بالعالم', 'rtl', font, 320 + (ascent - descent) / 2, video.ACCENT)
        with patch.object(video, 'word_places', return_value=None):
            actual = Image.new('RGB', expected.size, video.BACKGROUND)
            video._center_text(actual, 'مرحبا بالعالم', 320, FONT, 44, 24, 300, video.MAIN, 5)
        self.assertIsNone(ImageChops.difference(actual, expected).getbbox())

    def test_mp4_lights_rtl_words_in_turn_and_keeps_the_line_shaped(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            backing = root / 'backing.wav'
            with wave.open(str(backing), 'wb') as stream:
                stream.setnchannels(2)
                stream.setsampwidth(2)
                stream.setframerate(44100)
                stream.writeframes(b'\0' * 3 * 44100 * 4)
            text = 'مرحبا بالعالم'
            project = update_project(create_project('a' * 32, 'RTL clip', 3), 'RTL clip',
                                     [dict(start=0.5, end=2.5, text=text)], 0)
            output = root / 'video.mp4'
            from unittest.mock import patch
            with patch.object(video, 'render_card', wraps=video.render_card) as render:
                video.export_video(project, backing, output, root / 'work', FONT, threading.Event())
            # One card while the first word is sung, one once both are.
            self.assertEqual(sorted(len(call.kwargs['sung']) for call in render.call_args_list if call.args[1] == 0), [1, 2])
            font = ImageFont.truetype(str(FONT), 44)
            ascent, descent = font.getmetrics()
            unsung, sung = (whole_line(text, 'rtl', font, 320 + (ascent - descent) / 2, fill) for fill in (video.MAIN, video.ACCENT))
            # The first word is drawn on the right.
            (left_low, left_high), (right_low, right_high) = word_columns(unsung, sung, 220, 430)
            for seconds, lit in ((0.7, (False, True)), (2.0, (True, True))):
                frame = root / f'{seconds}.png'
                subprocess.run(['ffmpeg', '-v', 'error', '-i', str(output), '-ss', str(seconds),
                                '-frames:v', '1', '-y', str(frame)], check=True)
                with Image.open(frame) as image:
                    image = image.convert('RGB')
                    for (low, high), on in (((left_low, left_high), lit[0]), ((right_low, right_high), lit[1])):
                        box = (low, 220, high + 1, 430)
                        reference = (sung if on else unsung).crop(box)
                        # H.264 changes even the flat background. Measure glyph shape independently
                        # of that uniform colour shift, with a small antialiasing tolerance.
                        expected_mask = reference.convert('L').point(lambda value: 255 if value > 70 else 0)
                        actual_mask = image.crop(box).convert('L').point(lambda value: 255 if value > 70 else 0)
                        mismatch = ImageStat.Stat(ImageChops.difference(actual_mask, expected_mask)).mean[0] / 255
                        self.assertLess(mismatch, 0.002, (seconds, low))
                        self.assertLess(sum(ImageStat.Stat(ImageChops.difference(image.crop(box), reference)).mean), 9, (seconds, low))

    def test_export_refuses_unavailable_bidi_shaping_instead_of_scrambling_text(self):
        from unittest.mock import patch
        from karaoke.model import ValidationError
        from PIL import features  # load feature module before patching its platform probe
        self.assertTrue(features.check_feature('raqm'))
        with patch('PIL.features.check_feature', return_value=False):
            with self.assertRaisesRegex(ValidationError, 'RAQM'):
                video._center_text(Image.new('RGB', (1280, 720)), 'مرحبا بالعالم',
                                   320, FONT, 44, 24, 300, video.MAIN, 1)

    def test_export_refuses_incompatible_font_runs_but_uses_a_complete_fallback_face(self):
        from unittest.mock import patch
        from karaoke.model import ValidationError
        text = 'مرحبا hello'
        with tempfile.TemporaryDirectory() as temporary:
            import shutil
            fallback = Path(temporary) / 'fallback.ttf'
            shutil.copyfile(FONT, fallback)
            for complete in (False, True):
                video._fonts.cache_clear()
                def coverage(path, _index):
                    if path == str(FONT):
                        return ((0x20, 0x7e),)
                    return ((0x20, 0x10ffff),) if complete else ((0x600, 0x6ff),)
                with patch.object(video, '_coverage', side_effect=coverage), \
                        patch.object(video, '_system_fonts', return_value=((str(fallback), 0),)):
                    frame = Image.new('RGB', (1280, 720))
                    if complete:
                        video._center_text(frame, text, 320, FONT, 44, 24, 300, video.MAIN, 1)
                    else:
                        with self.assertRaisesRegex(ValidationError, 'font.*cover'):
                            video._center_text(frame, text, 320, FONT, 44, 24, 300, video.MAIN, 1)
            video._fonts.cache_clear()

    def test_unknown_font_coverage_is_refused_with_probe_setup_guidance(self):
        from unittest.mock import patch
        from karaoke.model import ValidationError
        with patch.object(video, '_coverage', return_value=None), \
                patch.object(video, '_system_fonts', return_value=()):
            with self.assertRaisesRegex(ValidationError, 'fontconfig'):
                video._center_text(Image.new('RGB', (1280, 720)), 'مرحبا दुनिया',
                                   320, FONT, 44, 24, 300, video.MAIN, 1)

    def test_missing_combining_mark_searches_beyond_partial_fonts_for_a_complete_face(self):
        from unittest.mock import patch
        import shutil
        with tempfile.TemporaryDirectory() as temporary:
            partial, complete = (Path(temporary) / name for name in ('partial.ttf', 'complete.ttf'))
            for path in (partial, complete):
                shutil.copyfile(FONT, path)
            def coverage(path, _index):
                if path == str(FONT):
                    return ((0, 0x60f), (0x611, 0x10ffff))
                if path == str(partial):
                    return ((0x610, 0x610),)
                return ((0, 0x10ffff),)
            with patch.object(video, '_coverage', side_effect=coverage), \
                    patch.object(video, '_system_fonts', return_value=((str(partial), 0), (str(complete), 0))) as lookup:
                video._center_text(Image.new('RGB', (1280, 720)), 'مرحبا\u0610 hello',
                                   320, FONT, 44, 24, 300, video.MAIN, 1)
                lookup.assert_called_once_with(0x610)
                self.assertIn((str(complete), 0), video._fonts(str(FONT)).faces)
