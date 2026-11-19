import tempfile
import threading
import unittest
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


if __name__ == '__main__':
    unittest.main()
