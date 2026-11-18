"""Where the words of lines with right-to-left text lie, and which are lit, as the preview finds them too."""
import json
import math
from pathlib import Path
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw, ImageFont

from karaoke import bidi

FONT = Path(__file__).resolve().parents[1] / 'assets' / 'DejaVuSans.ttf'
FIXTURE = json.loads((Path(__file__).parent / 'sung-stretches.json').read_text())


def ink_columns(text: str, direction: str, font: ImageFont.FreeTypeFont) -> list[tuple[int, int]]:
    """The line drawn on its own, as runs of columns with ink, from the left edge of its advance."""
    width = math.ceil(font.getlength(text, direction=direction))
    image = Image.new('L', (width + 40, 90), 0)
    ImageDraw.Draw(image).text((20, 60), text, font=font, fill=255, direction=direction)
    columns = [x - 20 for x in range(image.width) if image.crop((x, 0, x + 1, 90)).getbbox()]
    runs: list[list[int]] = []
    for column in columns:
        if runs and column - runs[-1][1] <= 1:
            runs[-1][1] = column
        else:
            runs.append([column, column])
    return [(low, high) for low, high in runs]


class BidiTests(unittest.TestCase):
    def test_sung_stretches_and_lit_words_agree_with_the_preview(self):
        for places, lit, expected in FIXTURE['stretches']:
            actual = bidi.sung_stretches([[tuple(piece) for piece in place] for place in places], lit)
            self.assertEqual(len(actual), len(expected), (lit, actual))
            for (low, high), (a, b) in zip(expected, actual, strict=True):
                self.assertEqual(a, -math.inf) if low is None else self.assertAlmostEqual(a, low)
                self.assertEqual(b, math.inf) if high is None else self.assertAlmostEqual(b, high)
        for line, count, expected in FIXTURE['lit']:
            self.assertEqual(bidi.lit_words(line, count), expected, (line, count))

    def test_levels_follow_the_bidirectional_algorithm(self):
        # Arabic is right to left; digits after Arabic letters are Arabic numbers, a level up.
        self.assertEqual(bidi.levels('مرحبا 123', True), [1] * 6 + [2] * 3)
        # A Latin phrase inside a right-to-left line is one left-to-right run, the space and digits in it included.
        self.assertEqual(bidi.levels('שלום hello 123', True), [1] * 5 + [2] * 9)
        # In a left-to-right line, Arabic and the number after it are embedded; the rest stays at the base level.
        self.assertEqual(bidi.levels('Sing مرحبا 123 now!', False), [0] * 5 + [1] * 6 + [2] * 3 + [0] * 5)
        # Brackets around Latin words in a right-to-left line take the line's direction.
        self.assertEqual(bidi.levels('(hello) مرحبا', True), [1] + [2] * 5 + [1] * 7)
        self.assertEqual(bidi.levels('', True), [])

    def test_words_are_placed_where_the_line_draws_their_ink(self):
        font = ImageFont.truetype(str(FONT), 44)
        # Each case: the line, its base direction, and its words from left to right as drawn (logical indices).
        for text, direction, order in [('مرحبا بالعالم', 'rtl', [1, 0]), ('שלום עולם 123', 'rtl', [2, 1, 0]),
                                       ('Sing مرحبا 123 now!', 'ltr', [0, 2, 1, 3]), ('אני אוהב you baby', 'rtl', [2, 3, 1, 0]),
                                       ('سلام، دنیا', 'rtl', [1, 0])]:
            with self.subTest(text=text):
                width = font.getlength(text, direction=direction)
                places = bidi.word_places(text, direction == 'rtl', lambda piece, side: font.getlength(piece, direction=side), width)
                self.assertEqual(len(places), len(text.split()))
                self.assertTrue(all(len(place) == 1 for place in places))
                self.assertEqual(sorted(range(len(places)), key=lambda word: places[word][0][0]), order)
                self.assertAlmostEqual(max(place[-1][1] for place in places), width, delta=0.01)
                # Every run of ink lies inside one word's place, and every word has ink.
                inked = set()
                for low, high in ink_columns(text, direction, font):
                    owners = [word for word, place in enumerate(places) if any(a - 3 <= low and high <= b + 3 for a, b in place)]
                    self.assertEqual(len(owners), 1, (low, high, places))
                    inked.add(owners[0])
                self.assertEqual(inked, set(range(len(places))))

    def test_a_word_split_by_the_ordering_has_a_piece_on_each_side(self):
        font = ImageFont.truetype(str(FONT), 44)
        text = 'عربيabc xyz'
        places = bidi.word_places(text, True, lambda piece, side: font.getlength(piece, direction=side),
                                  font.getlength(text, direction='rtl'))
        # "abc" is drawn at the left, "xyz" after it, and the Arabic letters at the right.
        self.assertEqual(len(places[0]), 2)
        self.assertLess(places[0][0][1], places[1][0][0])
        self.assertLessEqual(places[1][0][1], places[0][1][0] + 0.01)

    def test_without_fribidi_no_places_are_claimed(self):
        with patch.object(bidi, '_fribidi', return_value=None):
            self.assertIsNone(bidi.levels('مرحبا', True))
            self.assertIsNone(bidi.word_places('مرحبا', True, lambda piece, side: 10.0, 10.0))


if __name__ == '__main__':
    unittest.main()
