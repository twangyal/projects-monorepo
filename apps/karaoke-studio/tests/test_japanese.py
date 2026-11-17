"""Japanese lyrics read in romaji for the letter aligner, with a stand-in for the reading dictionary."""
import importlib.util
import unittest
from unittest import mock

from karaoke.alignment import alignable, force_align, readings, word_letters
from karaoke.japanese import CONTINUED, japanese_readings, romaji
from karaoke.lyrics_auto import LEAD_IN, word_timings
from tests.test_alignment import sung

WORDS = {'出して輝き続けよ': [('出し', 'ダシ'), ('て', 'テ'), ('輝き', 'カガヤキ'), ('続けよ', 'ツヅケヨ')],
         '東京の夜baby': [('東京', 'トウキョウ'), ('の', 'ノ'), ('夜', 'ヨル'), ('baby', 'ベイビー')],
         '君の名は': [('君', 'キミ'), ('の', 'ノ'), ('名', 'ナ'), ('は', 'ハ')],
         '空を見上げて': [('空', 'ソラ'), ('を', 'ヲ'), ('見上げ', 'ミアゲ'), ('て', 'テ')]}
DICTIONARY = mock.patch('karaoke.japanese._dictionary', return_value=lambda text: WORDS[text])


class RomajiTests(unittest.TestCase):
    def test_kana_are_read_from_the_table_with_small_kana_doubled_consonants_and_long_vowels(self):
        self.assertEqual(romaji('きゃしゃちょじゅ'), ['kya', CONTINUED, 'sha', CONTINUED, 'cho', CONTINUED, 'ju', CONTINUED])
        self.assertEqual(romaji('ファティ'), ['fa', CONTINUED, 'ti', CONTINUED])
        self.assertEqual(romaji('きって'), ['ki', 't', 'te'])
        self.assertEqual(romaji('ラーメン'), ['ra', 'a', 'me', 'n'])

    def test_kanji_take_their_word_reading_less_its_kana_and_other_scripts_stay_unread(self):
        def words(text):
            return WORDS[text]
        self.assertEqual(japanese_readings('出して輝き続けよ', words), ['da', 'shi', 'te', 'kagaya', 'ki', 'tsuzu', 'ke', 'yo'])
        # A run of kanji is read on its first, the rest with it; Latin letters are left to the aligner's own spelling.
        self.assertEqual(japanese_readings('東京の夜baby', words), ['toukyou', CONTINUED, 'no', 'yoru', None, None, None, None])
        # A word whose reading does not fit its characters is left unread rather than misread.
        self.assertEqual(japanese_readings('見えない', lambda _: [('見えない', 'ミ')]), [None, None, None, None])
        with mock.patch('karaoke.japanese._dictionary', return_value=None):
            self.assertIsNone(japanese_readings('出して輝き続けよ'))


class JapaneseAlignmentTests(unittest.TestCase):
    def test_japanese_lines_are_readable_only_in_a_japanese_song_with_the_dictionary(self):
        with DICTIONARY:
            self.assertTrue(alignable(['出して輝き続けよ', '東京の夜baby'], 'ja'))
            self.assertEqual(word_letters('東京の夜baby', 'ja'), ['TOUKYOU', '', 'NO', 'YORU', 'BABY'])
            self.assertEqual(readings('君の名は', 'ja'), ['kimi', 'no', 'na', 'ha'])
            for language in (None, 'zh', 'yue'):
                self.assertFalse(alignable(['出して輝き続けよ'], language), language)
        with mock.patch('karaoke.japanese._dictionary', return_value=None):
            self.assertFalse(alignable(['出して輝き続けよ'], 'ja'))

    def test_japanese_lines_start_where_their_romaji_is_sung(self):
        sung_at = [('出して輝き続けよ', 1.5), ('君の名は', 8.0), ('空を見上げて', 13.0)]
        with DICTIONARY:
            log_probs = sung(sung_at, 20, language='ja')
            cues = force_align([text for text, _ in sung_at], log_probs, 20, 'ja')
        self.assertEqual([cue['text'] for cue in cues], [text for text, _ in sung_at])
        for cue, (_, start) in zip(cues, sung_at, strict=True):
            self.assertAlmostEqual(cue['start'] + LEAD_IN, start, delta=0.05)
        self.assertIsNone(force_align([text for text, _ in sung_at], log_probs, 20))

    def test_japanese_characters_keep_the_recognized_words_timing(self):
        cue = dict(start=1.3, end=4.5, text='君の名は')
        with DICTIONARY:
            log_probs = sung([('君の名は', 1.5)], 6, language='ja')
            self.assertEqual(word_timings([cue], [], 6, log_probs, 'ja'), word_timings([cue], [], 6))


@unittest.skipUnless(importlib.util.find_spec('sudachipy'), 'the optional Japanese reading dictionary is not installed')
class InstalledDictionaryTests(unittest.TestCase):
    def test_the_small_dictionary_reads_a_sung_line(self):
        self.assertEqual(japanese_readings('出して輝き続けよ'), ['da', 'shi', 'te', 'kagaya', 'ki', 'tsuzu', 'ke', 'yo'])
