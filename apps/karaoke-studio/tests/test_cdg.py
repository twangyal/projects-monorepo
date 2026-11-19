import tempfile
import threading
import unittest
from unittest.mock import patch

from karaoke import cdg
from karaoke.jobs import JobManager
import zipfile
from pathlib import Path

from karaoke.cdg import (BACKGROUND, HEIGHT, MUTED, PACKETS_PER_SECOND, ROWS, SUNG, TEXT, TILE_HEIGHT, TILE_WIDTH, WIDTH,
                         export_cdg, layout, packet, palette, render_cdg, tile)
from karaoke.model import create_project, update_project

FONT = Path(__file__).resolve().parents[1] / 'assets' / 'DejaVuSans.ttf'


class Screen:
    """A small CD+G player: replays the packets up to a moment onto the screen's colour numbers."""

    def __init__(self, data: bytes):
        self.data = data
        self.colours = [None] * 16

    def at(self, seconds: float) -> list[list[int]]:
        pixels = [[0] * WIDTH for _ in range(HEIGHT)]
        for start in range(0, min(len(self.data), round(seconds * PACKETS_PER_SECOND) * 24), 24):
            item = self.data[start:start + 24]
            if item[0] & 0x3F != 0x09:
                continue
            instruction, data = item[1] & 0x3F, item[4:20]
            if instruction == 1:
                for row in pixels:
                    row[:] = [data[0] & 0x0F] * WIDTH
            elif instruction in (6, 38):
                colour0, colour1, row, column = data[0] & 0x0F, data[1] & 0x0F, data[2] & 0x1F, data[3] & 0x3F
                for y in range(TILE_HEIGHT):
                    for x in range(TILE_WIDTH):
                        on = data[4 + y] >> (5 - x) & 1
                        value = colour1 if on else colour0
                        at_y, at_x = row * TILE_HEIGHT + y, column * TILE_WIDTH + x
                        pixels[at_y][at_x] = pixels[at_y][at_x] ^ value if instruction == 38 else value
            elif instruction in (30, 31):
                for k in range(8):
                    high, low = data[2 * k] & 0x3F, data[2 * k + 1] & 0x3F
                    self.colours[k + (8 if instruction == 31 else 0)] = (high >> 2, (high & 3) << 2 | low >> 4, low & 0x0F)
        return pixels


def count(pixels: list[list[int]], colour: int, rows: range | None = None) -> int:
    return sum(row.count(colour) for y, row in enumerate(pixels) if rows is None or y in rows)


def place_rows(first_row: int) -> range:
    return range(first_row * TILE_HEIGHT, (first_row + 3) * TILE_HEIGHT)


class CdgTests(unittest.TestCase):
    def setUp(self):
        self.project = update_project(create_project('c' * 32, 'Nina - Blue Skies', 30.0), 'Nina - Blue Skies',
                                      [dict(start=8.0, end=10.0, text='Hello little world'), dict(start=11.0, end=13.0, text='Sing it back'),
                                       dict(start=14.0, end=16.0, text='Third line here'), dict(start=17.0, end=19.0, text='Fourth line now'),
                                       dict(start=20.0, end=22.0, text='Fifth comes back')], 0)
        self.words = [dict(text=text, start=start, end=start + 0.4, confidence=0.9)
                      for text, start in [('Hello', 8.0), ('little', 8.6), ('world', 9.2), ('Sing', 11.0), ('it', 11.6), ('back', 12.2)]]

    def test_packets_tiles_and_colours_are_encoded_as_cd_g_expects(self):
        self.assertEqual(len(packet(1, bytes([3, 0]))), 24)
        block = tile(0, 5, 17, 49, [0b111111] + [0] * 11)
        self.assertEqual((block[0], block[1], block[4:8], block[8]), (0x09, 6, bytes([0, 5, 17, 49]), 0b111111))
        self.assertEqual(tile(0, 3, 1, 1, [1] * 12, xor=True)[1], 38)
        with self.assertRaises(ValueError):
            tile(0, 1, ROWS, 0, [0] * 12)
        low, high = palette(['#ffffff', '#000000', '#ff8800'])
        screen = Screen(low + high)
        screen.at(1)
        self.assertEqual(screen.colours[:3], [(15, 15, 15), (0, 0, 0), (15, 8, 0)])
        self.assertEqual((low[1], high[1]), (30, 31))

    def test_the_file_lasts_as_long_as_the_clip_and_opens_on_the_title(self):
        data = render_cdg(self.project, FONT, words=self.words)
        self.assertEqual(len(data), 30 * PACKETS_PER_SECOND * 24)
        screen = Screen(data)
        title = screen.at(1.0)
        # Title and artist in their colours, before any lyrics.
        self.assertGreater(count(title, TEXT, place_rows(5)), 100)
        self.assertGreater(count(title, MUTED, place_rows(9)), 100)
        self.assertEqual(count(title, SUNG), 0)
        self.assertEqual(screen.colours[BACKGROUND], (1, 2, 3))

    def test_lines_appear_before_they_are_sung_light_up_word_by_word_and_clear_after(self):
        screen = Screen(render_cdg(self.project, FONT, words=self.words))
        first = place_rows(2)
        # Each line appears five seconds before it is sung, in the next of four places, and the title is gone.
        ahead = screen.at(7.5)
        self.assertEqual(count(ahead, MUTED), 0)
        self.assertGreater(count(ahead, TEXT, place_rows(2)), 100)
        self.assertGreater(count(ahead, TEXT, place_rows(6)), 100)
        self.assertEqual(count(ahead, TEXT, place_rows(10)) + count(ahead, TEXT, place_rows(14)), 0)
        self.assertEqual(count(ahead, SUNG), 0)
        self.assertGreater(count(screen.at(12.5), TEXT, place_rows(14)), 100)
        # Part way through, "Hello" is lit and "world" is not.
        during = screen.at(8.7)
        lit, unlit = count(during, SUNG, first), count(during, TEXT, first)
        self.assertGreater(lit, 50)
        self.assertGreater(unlit, lit)
        # Lit pixels lie to the left of the unlit ones.
        lit_x = max(x for y in first for x in range(WIDTH) if during[y][x] == SUNG)
        unlit_x = max(x for y in first for x in range(WIDTH) if during[y][x] == TEXT)
        self.assertLess(lit_x, unlit_x)
        # Sung through, the whole line is lit, then cleared; its place takes the fifth line five seconds before it.
        done = screen.at(9.95)
        self.assertEqual(count(done, TEXT, first), 0)
        self.assertGreater(count(done, SUNG, first), 200)
        after = screen.at(11.0)
        self.assertEqual(count(after, SUNG, first) + count(after, TEXT, first), 0)
        self.assertGreater(count(screen.at(15.5), TEXT, first), 100)
        # At the end nothing is left on screen.
        self.assertEqual(count(screen.at(29.9), TEXT) + count(screen.at(29.9), SUNG), 0)

    def test_long_lines_wrap_and_styles_set_colours_and_size(self):
        project = update_project(self.project, self.project['title'],
                                 [dict(start=8.0, end=14.0, text='This lyric line is far too long to fit across the small karaoke screen')], 1)
        lines = layout(project, FONT)
        self.assertGreaterEqual(len(lines), 3)
        self.assertTrue(all(0 <= word[2] < word[3] <= WIDTH for line in lines for word in line.words))
        self.assertEqual(lines[-1].end, 14.0)
        self.assertLess(lines[0].end, lines[1].start + 0.001)
        self.assertGreater(len(layout(project, FONT, size=24)), len(lines) - 1)
        contrast = Screen(render_cdg(self.project, FONT, 'contrast'))
        contrast.at(1)
        self.assertEqual(contrast.colours[:3], [(0, 0, 0), (15, 15, 15), (15, 12, 0)])
        with self.assertRaises(ValueError):
            render_cdg(self.project, FONT, 'neon')
        with self.assertRaises(ValueError):
            render_cdg(update_project(self.project, 'x', [], 2), FONT)

    def test_a_clip_without_an_artist_shows_its_name_alone(self):
        project = update_project(self.project, 'Demo take', self.project['cues'], 1)
        title = Screen(render_cdg(project, FONT)).at(1.0)
        self.assertGreater(count(title, TEXT, place_rows(5)), 50)
        self.assertEqual(count(title, MUTED), 0)

    def test_spaceless_and_other_scripts_are_drawn(self):
        project = update_project(self.project, '月亮', [dict(start=3.0, end=5.0, text='我爱你'), dict(start=6.0, end=8.0, text='Привет мир')], 1)
        screen = Screen(render_cdg(project, FONT))
        self.assertGreater(count(screen.at(3.2), TEXT, place_rows(6)), 50)

    def test_the_song_is_zipped_as_matching_cdg_and_mp3_files(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            backing = work / 'backing.wav'
            backing.write_bytes(b'RIFF')
            stages, encoded = [], []
            def encode(source, target):
                encoded.append(source)
                target.write_bytes(b'ID3 mp3')
            output = export_cdg(self.project, backing, work, encode, FONT, threading.Event(), stages.append, words=self.words)
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(sorted(archive.namelist()), ['Nina - Blue Skies.cdg', 'Nina - Blue Skies.mp3'])
                self.assertEqual(len(archive.read('Nina - Blue Skies.cdg')), 30 * PACKETS_PER_SECOND * 24)
                self.assertEqual(archive.read('Nina - Blue Skies.mp3'), b'ID3 mp3')
            self.assertEqual(encoded, [backing])
            self.assertEqual(stages, ['Drawing the karaoke graphics', 'Encoding the backing as MP3'])
            cancel = threading.Event()
            cancel.set()
            with self.assertRaises(RuntimeError):
                export_cdg(self.project, backing, work, encode, FONT, cancel, stages.append)


    def test_already_cancelled_export_does_not_begin_graphics_or_encoding(self):
        cancel = threading.Event()
        cancel.set()
        with tempfile.TemporaryDirectory() as directory, patch('karaoke.cdg._pixels', wraps=cdg._pixels) as pixels:
            with self.assertRaisesRegex(RuntimeError, 'cancelled'):
                export_cdg(self.project, Path('backing.wav'), Path(directory),
                           lambda *_: self.fail('Cancelled export encoded audio'), FONT, cancel, lambda _: None)
            pixels.assert_not_called()

    def test_cancellation_in_word_timing_does_not_align_the_remaining_cues(self):
        cancel = threading.Event()
        def forced(*args, **kwargs):
            cancel.set()
            return None
        with patch('karaoke.alignment.force_words', side_effect=forced) as align:
            with self.assertRaisesRegex(RuntimeError, 'cancelled'):
                render_cdg(self.project, FONT, letters=object(), cancel=cancel)
        self.assertEqual(align.call_count, 1)

    def test_cancellation_during_word_matching_stops_the_alignment_frontier(self):
        from karaoke import word_alignment
        cancel = threading.Event()
        project = update_project(self.project, 'Long lyric', [dict(start=1.0, end=29.0, text=' '.join(['hello'] * 40))], 1)
        words = [dict(text='hella', start=1 + n * 0.22, end=1.1 + n * 0.22) for n in range(120)]
        similar = word_alignment.similar
        def compared(*args):
            value = similar(*args)
            cancel.set()
            return value
        with patch('karaoke.word_alignment.similar', side_effect=compared) as compare:
            with self.assertRaisesRegex(RuntimeError, 'cancelled'):
                render_cdg(project, FONT, words=words, cancel=cancel)
        self.assertEqual(compare.call_count, 1)

    def test_cancellation_during_letter_alignment_stops_between_frame_steps(self):
        import numpy as np
        from karaoke.alignment import CLASSES
        cancel = threading.Event()
        maximum = np.maximum
        def advanced(*args, **kwargs):
            value = maximum(*args, **kwargs)
            cancel.set()
            return value
        with patch('numpy.maximum', side_effect=advanced) as advance:
            with self.assertRaisesRegex(RuntimeError, 'cancelled'):
                render_cdg(self.project, FONT, letters=np.zeros((1500, CLASSES), dtype=np.float32), cancel=cancel)
        # Each frame step takes two maximums; no second frame should be processed.
        self.assertEqual(advance.call_count, 2)

    def test_cancellation_during_layout_stops_before_drawing_more_words(self):
        cancel = threading.Event()
        measure = cdg._measure
        def measured(*args):
            value = measure(*args)
            cancel.set()
            return value
        with patch('karaoke.cdg._measure', side_effect=measured), patch('karaoke.cdg._pixels', wraps=cdg._pixels) as pixels:
            with self.assertRaisesRegex(RuntimeError, 'cancelled'):
                layout(self.project, FONT, cancel=cancel)
            pixels.assert_not_called()

    def test_cancellation_during_tiles_stops_before_packet_scheduling(self):
        cancel = threading.Event()
        tiles = cdg._tiles
        def drawn(*args, **kwargs):
            value = tiles(*args, **kwargs)
            cancel.set()
            return value
        with patch('karaoke.cdg._tiles', side_effect=drawn), patch('karaoke.cdg._schedule') as schedule:
            with self.assertRaisesRegex(RuntimeError, 'cancelled'):
                render_cdg(self.project, FONT, cancel=cancel)
            schedule.assert_not_called()

    def test_packet_scheduling_checks_cancellation_between_packets(self):
        class CancelAfterFirstCheck:
            calls = 0
            active = False
            def is_set(self):
                if self.active:
                    self.calls += 1
                return self.calls > 1
        cancel = CancelAfterFirstCheck()
        schedule = cdg._schedule
        def scheduling(*args, **kwargs):
            cancel.active = True
            return schedule(*args, **kwargs)
        with patch('karaoke.cdg._schedule', side_effect=scheduling):
            with self.assertRaisesRegex(RuntimeError, 'cancelled'):
                render_cdg(self.project, FONT, cancel=cancel)
        self.assertEqual(cancel.calls, 2)

    def test_cancellation_in_encoder_does_not_package_or_replace_previous_output(self):
        cancel = threading.Event()
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            previous = work / 'export.mp3g.zip'
            previous.write_bytes(b'previous complete export')
            def encode(_, target):
                target.write_bytes(b'ID3 mp3')
                cancel.set()
            with self.assertRaisesRegex(RuntimeError, 'cancelled'):
                export_cdg(self.project, work / 'backing.wav', work, encode, FONT, cancel, lambda _: None)
            self.assertEqual(previous.read_bytes(), b'previous complete export')

    def test_cancelled_graphics_job_releases_worker_without_rendering_rest_or_publishing(self):
        manager = JobManager()
        begun, resume = threading.Event(), threading.Event()
        measure = cdg._measure
        measured = []
        def held(*args):
            measured.append(args[0])
            if len(measured) == 1:
                begun.set()
                if not resume.wait(5):
                    raise RuntimeError('Test did not release layout')
            return measure(*args)
        published, cleaned = [], []
        try:
            with tempfile.TemporaryDirectory() as directory, patch('karaoke.cdg._measure', side_effect=held):
                def work(cancel, stage):
                    export_cdg(self.project, Path('backing.wav'), Path(directory),
                               lambda *_: self.fail('Cancelled job encoded audio'), FONT, cancel, stage)
                    return lambda: published.append('new export')
                job = manager.start(self.project['id'], 'mp3g-export', work, lambda: cleaned.append(True))
                self.assertTrue(begun.wait(5))
                manager.cancel(job['id'])
                resume.set()
                manager._jobs[job['id']].thread.join(5)
                self.assertEqual(manager.get(job['id'])['status'], 'cancelled')
                self.assertEqual(len(measured), 1, 'cancelled layout did not keep measuring the other lyrics')
                self.assertEqual(published, [])
                self.assertEqual(cleaned, [True])
                self.assertIsNone(manager.active())
                following = manager.start(self.project['id'], 'export', lambda *_: lambda: 'next export')
                manager._jobs[following['id']].thread.join(5)
                self.assertEqual(manager.get(following['id'])['status'], 'complete')
        finally:
            resume.set()
            manager.shutdown()


if __name__ == '__main__':
    unittest.main()
