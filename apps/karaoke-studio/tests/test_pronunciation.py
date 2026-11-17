import unittest
from unittest import mock

from karaoke.lyrics_auto import lyric_words
from karaoke.pronunciation import pronunciation, said_line

# A stand-in for the Japanese reading dictionary's tokens: surface, reading in katakana, whether it is a particle.
TOKENS = {
    '君の名は': [('君', 'キミ', False), ('の', 'ノ', True), ('名', 'ナ', False), ('は', 'ハ', True)],
    '東京へ行こう': [('東京', 'トウキョウ', False), ('へ', 'ヘ', True), ('行こう', 'イコウ', False)],
    'Hello 世界': [('Hello', 'Hello', False), (' ', '', False), ('世界', 'セカイ', False)],
    '雨を見た': [('雨', 'アメ', False), ('を', 'ヲ', True), ('見', 'ミ', False), ('た', 'タ', False)],
}


def tagger(text):
    return TOKENS[text]


class PronunciationTest(unittest.TestCase):
    def test_korean_and_cyrillic_are_respelled_word_by_word_and_latin_words_kept(self):
        self.assertEqual(pronunciation('사랑해 너를'), ['saranghae', 'neoreul'])
        self.assertEqual(pronunciation('I love you, 사랑해!'), ['I', 'love', 'you,', 'saranghae!'])
        self.assertEqual(pronunciation('Я тебя люблю'), ['Ya', 'tebya', 'lyublyu'])
        self.assertEqual(said_line(pronunciation('Я тебя люблю')), 'Ya tebya lyublyu')

    def test_chinese_is_read_in_pinyin_with_tone_marks_only_in_a_song_recognized_as_mandarin(self):
        self.assertEqual(pronunciation('我爱你', 'zh'), ['wǒ', 'ài', 'nǐ'])
        # A character with several readings takes its phrase's: 长 in 长大 is zhǎng.
        self.assertEqual(pronunciation('长大', 'zh'), ['zhǎng', 'dà'])
        for language in (None, 'yue', 'ko'):
            self.assertIsNone(pronunciation('我爱你', language), language)

    def test_japanese_is_read_word_by_word_in_romaji_with_particles_as_they_are_said(self):
        pieces = pronunciation('君の名は', 'ja', tagger)
        self.assertEqual(pieces, ['kimi', 'no', 'na', 'wa'])
        # The rest of a word is read with its first character, so the pieces match the words the line is timed by.
        self.assertEqual(pronunciation('東京へ行こう', 'ja', tagger), ['toukyou', '', 'e', 'ikou', '', ''])
        self.assertEqual(len(pronunciation('東京へ行こう', 'ja', tagger)), len(lyric_words('東京へ行こう')))
        self.assertEqual(said_line(pronunciation('雨を見た', 'ja', tagger)), 'ame o mi ta')
        self.assertEqual(pronunciation('Hello 世界', 'ja', tagger), ['Hello', 'sekai', ''])
        # Without the reading dictionary, or in a song not recognized as Japanese, Japanese is not read.
        with mock.patch('karaoke.japanese._tagger', return_value=None):
            self.assertIsNone(pronunciation('君の名は', 'ja'))
        self.assertIsNone(pronunciation('君の名は', 'zh'))

    def test_lines_needing_no_pronunciation_or_unreadable_have_none(self):
        for text, language in [('hello world', None), ('Café olé', 'fr'), ('รักเธอ', None), ('사랑 รัก', None), ('', None)]:
            self.assertIsNone(pronunciation(text, language), text)


if __name__ == '__main__':
    unittest.main()
