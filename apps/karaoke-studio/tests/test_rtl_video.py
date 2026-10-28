"""Compare exported lyric pixels with independently shaped whole-line text."""
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


class RtlVideoTests(unittest.TestCase):
    def setUp(self):
        video._fonts.cache_clear()
        self.addCleanup(video._fonts.cache_clear)

    def test_layout_matches_preview_behavior_fixture(self):
        import json
        cases = json.loads((Path(__file__).parent / 'text-direction.json').read_text())
        for text, direction, whole_line in cases:
            self.assertEqual(video.text_layout(text), (direction, whole_line), text)

    def test_rtl_cues_keep_whole_shaped_lines_at_every_sung_boundary(self):
        for text, direction in [('مرحبا بالعالم', 'rtl'), ('שלום עולם 123', 'rtl'),
                                ('Sing مرحبا 123 now!', 'ltr'), ('مرحبا hello 123', 'rtl'),
                                ('مرحبا بالعالم\nשלום עולם', 'rtl'), (' '.join(['مرحبا'] * 20), 'rtl')]:
            font = ImageFont.truetype(str(FONT), 44)
            expected = Image.new('RGB', (1280, 720), video.BACKGROUND)
            draw = ImageDraw.Draw(expected)
            lines = ([' '.join(['مرحبا'] * count) for count in (8, 8, 4)]
                     if text == ' '.join(['مرحبا'] * 20) else text.split('\n'))
            ascent, descent = font.getmetrics()
            for index, line in enumerate(lines):
                baseline = 320 + (index - (len(lines) - 1) / 2) * 55 + (ascent - descent) / 2
                draw.text((640, baseline), line, font=font, fill=video.ACCENT, anchor='ms', direction=direction)
            for sung in (0, 1, 5, 500):
                with self.subTest(text=text, sung=sung):
                    actual = Image.new('RGB', expected.size, video.BACKGROUND)
                    video._center_text(ImageDraw.Draw(actual), text, 320, FONT, 44, 24, 300, video.MAIN, sung)
                    self.assertIsNone(ImageChops.difference(actual, expected).getbbox())

    def test_mp4_keeps_the_complete_rtl_line_across_word_boundaries(self):
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
            self.assertEqual(sum(call.args[1] == 0 for call in render.call_args_list), 1,
                             'whole-line highlighting needs one active card, not one duplicate per word')
            reference = Image.new('RGB', (1280, 720), video.BACKGROUND)
            font = ImageFont.truetype(str(FONT), 44)
            ascent, descent = font.getmetrics()
            ImageDraw.Draw(reference).text((640, 320 + (ascent - descent) / 2), text, font=font,
                                            fill=video.ACCENT, anchor='ms', direction='rtl')
            reference = reference.crop((100, 220, 1180, 430))
            for seconds in (0.7, 2.0):
                frame = root / f'{seconds}.png'
                subprocess.run(['ffmpeg', '-v', 'error', '-i', str(output), '-ss', str(seconds),
                                '-frames:v', '1', '-y', str(frame)], check=True)
                with Image.open(frame) as image:
                    difference = ImageChops.difference(image.convert('RGB').crop((100, 220, 1180, 430)), reference)
                    # H.264 changes even the flat background. Measure glyph shape independently
                    # of that uniform colour shift, with a small antialiasing tolerance.
                    expected_mask = reference.convert('L').point(lambda value: 255 if value > 70 else 0)
                    actual_mask = image.convert('L').crop((100, 220, 1180, 430)).point(lambda value: 255 if value > 70 else 0)
                    mismatch = ImageStat.Stat(ImageChops.difference(actual_mask, expected_mask)).mean[0] / 255
                    self.assertLess(mismatch, 0.001)
                    self.assertLess(sum(ImageStat.Stat(difference).mean), 7)

    def test_export_refuses_unavailable_bidi_shaping_instead_of_scrambling_text(self):
        from unittest.mock import patch
        from karaoke.model import ValidationError
        from PIL import features  # load feature module before patching its platform probe
        self.assertTrue(features.check_feature('raqm'))
        with patch('PIL.features.check_feature', return_value=False):
            with self.assertRaisesRegex(ValidationError, 'RAQM'):
                video._center_text(ImageDraw.Draw(Image.new('RGB', (1280, 720))), 'مرحبا بالعالم',
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
                    draw = ImageDraw.Draw(Image.new('RGB', (1280, 720)))
                    if complete:
                        video._center_text(draw, text, 320, FONT, 44, 24, 300, video.MAIN, 1)
                    else:
                        with self.assertRaisesRegex(ValidationError, 'font.*cover'):
                            video._center_text(draw, text, 320, FONT, 44, 24, 300, video.MAIN, 1)
            video._fonts.cache_clear()

    def test_unknown_font_coverage_is_refused_with_probe_setup_guidance(self):
        from unittest.mock import patch
        from karaoke.model import ValidationError
        with patch.object(video, '_coverage', return_value=None), \
                patch.object(video, '_system_fonts', return_value=()):
            with self.assertRaisesRegex(ValidationError, 'fontconfig'):
                video._center_text(ImageDraw.Draw(Image.new('RGB', (1280, 720))), 'مرحبا दुनिया',
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
                video._center_text(ImageDraw.Draw(Image.new('RGB', (1280, 720))), 'مرحبا\u0610 hello',
                                   320, FONT, 44, 24, 300, video.MAIN, 1)
                lookup.assert_called_once_with(0x610)
                self.assertIn((str(complete), 0), video._fonts(str(FONT)).faces)
