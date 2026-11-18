import unittest

from karaoke.devanagari import readings, romanized


class DevanagariTest(unittest.TestCase):
    def test_words_are_read_as_hindi_says_them(self):
        # The inherent a is dropped at a word's end and between sounded syllables, but not where three consonants
        # would meet; long vowels are doubled as film lyrics are usually written.
        for word, said in [('तुम', 'tum'), ('ही', 'hee'), ('हो', 'ho'), ('दिल', 'dil'), ('कमल', 'kamal'), ('करना', 'karnaa'),
                           ('अपना', 'apnaa'), ('बचपन', 'bachpan'), ('समझना', 'samajhnaa'), ('ज़िंदगी', 'zindagee'), ('प्यार', 'pyaar'),
                           ('मैं', 'main'), ('है', 'hai'), ('क्या', 'kyaa'), ('न', 'na'), ('आँखें', 'aankhen'), ('जादू', 'jaadoo')]:
            self.assertEqual(romanized(word), said, word)

    def test_dotted_letters_take_their_urdu_sounds_however_they_are_written(self):
        # ज़ and फ़ as a letter and a dot, and as single precomposed characters.
        self.assertEqual(romanized('ज़रा'), 'zaraa')
        self.assertEqual(romanized('ज़रा'), 'zaraa')
        self.assertEqual(romanized('फ़िर'), 'fir')
        self.assertEqual(romanized('फ़िर'), 'fir')

    def test_each_syllable_is_read_on_its_first_character(self):
        self.assertEqual(readings('करना'), ['ka', 'r', 'naa', ''])
        self.assertEqual(readings('प्यार'), ['p', '', 'yaa', '', 'r'])
        self.assertEqual(readings('प्यार', long_vowels=False), ['p', '', 'ya', '', 'r'])
        self.assertEqual(readings('ज़रा'), ['za', 'raa', ''])
        # Other characters are kept when romanized.
        self.assertEqual(romanized('दिल,'), 'dil,')


if __name__ == '__main__':
    unittest.main()
