"""Long-song regressions and an independent edit-distance oracle."""
import unittest

from karaoke.lyrics_auto import align_lines


class LongAlignmentTests(unittest.TestCase):
    def test_one_changed_word_does_not_erase_a_long_songs_timing(self):
        tokens = ['one', 'two', 'three', 'four', 'five', 'six'] * 200
        heard = [dict(text=t, start=i * .4, end=i * .4 + .1) for i, t in enumerate(tokens)]
        heard[603]['text'] = 'wrong'
        cues = align_lines([' '.join(tokens[i:i+6]) for i in range(0, len(tokens), 6)], heard, 480)
        self.assertEqual(len(cues), 200)
        self.assertEqual(cues[0]['matched'], 1)
        self.assertEqual(cues[-1]['matched'], 1)
        self.assertAlmostEqual(cues[100]['start'], 239.85)
        self.assertAlmostEqual(cues[-1]['start'], 477.45)
        self.assertGreater(cues[100]['matched'], .8)


class AlignmentPathTests(unittest.TestCase):
    def test_short_edit_paths_match_an_exhaustive_distance_oracle(self):
        import itertools
        from karaoke.word_alignment import align, similar

        def distance(a, b):
            table = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
            for i in range(len(a) + 1):
                table[i][0] = i
            for j in range(len(b) + 1):
                table[0][j] = j
            for i, x in enumerate(a, 1):
                for j, y in enumerate(b, 1):
                    table[i][j] = min(table[i-1][j] + 1, table[i][j-1] + 1,
                                      table[i-1][j-1] + (not similar(x, y)))
            return table[-1][-1]

        sequences = [list(p) for size in range(5) for p in itertools.product(('la', 'oh'), repeat=size)]
        sequences += [['night', 'gonna', 'awake'], ['nite', 'gona', 'awake'], ['awake', 'night']]
        for a in sequences:
            for b in sequences:
                with self.subTest(reference=a, heard=b):
                    matches = align(a, b)
                    self.assertEqual(len(matches), len(a))
                    pairs = [(i, j) for i, j in enumerate(matches) if j is not None]
                    self.assertEqual([j for _, j in pairs], sorted({j for _, j in pairs}))
                    self.assertTrue(all(similar(a[i], b[j]) for i, j in pairs))
                    cost, prev_i, prev_j = 0, -1, -1
                    for i, j in pairs + [(len(a), len(b))]:
                        cost += max(i - prev_i - 1, j - prev_j - 1)
                        prev_i, prev_j = i, j
                    self.assertEqual(cost, distance(a, b))

    def test_long_insertions_deletions_and_spelling_errors_keep_exact_survivors(self):
        from karaoke.word_alignment import align
        # Short distinct tokens cannot fuzzy-match each other.
        tokens = [f'{chr(97 + i // 26)}{chr(97 + i % 26)}' for i in range(500)] * 3
        heard = tokens[:401] + ['EXTRA'] + tokens[401:902] + tokens[903:]
        heard[1100] = 'WRONG'
        matched = align(tokens, heard)
        self.assertEqual(matched[:401], list(range(401)))
        self.assertEqual(matched[401:902], list(range(402, 903)))
        self.assertIsNone(matched[902])
        self.assertIsNone(matched[1100])
        self.assertEqual(matched[1101:], list(range(1101, len(tokens))))
        self.assertEqual(align(['gonna'] * 1200, ['gona'] * 1200), list(range(1200)))

    def test_real_work_limit_is_explicit_and_is_shared_across_calls(self):
        from karaoke.word_alignment import AlignmentBudget, align
        budget = AlignmentBudget(30)
        self.assertEqual(align(['one'] * 5, ['one'] * 5, budget), list(range(5)))
        self.assertEqual(budget.remaining, 20)
        with self.assertRaisesRegex(ValueError, 'differ too much.*saved lyrics are unchanged'):
            align(['one'] * 20, ['one'] * 20, budget)
        with self.assertRaisesRegex(ValueError, 'differ too much'):
            align(['same', 'aa'] * 50, ['same', 'bb'] * 50, AlignmentBudget(250))
