import unittest

from karaoke.indic import readings, romanized


class IndicTest(unittest.TestCase):
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

    def test_the_other_indian_scripts_are_read_as_their_languages_say_them(self):
        # Bengali carries o and does not double long vowels; Punjabi drops its a like Hindi and doubles after an addak;
        # the southern languages and Odia sound every vowel.
        for words, said in [('আমি তোমাকে ভালোবাসি', 'ami tomake bhalobasi'), ('কলম', 'kolom'), ('আমার সোনার বাংলা', 'amar sonar bangla'),
                            ('ਸਤ ਸ੍ਰੀ ਅਕਾਲ', 'sat sree akaal'), ('ਪੱਗ', 'pagg'), ('ਖ਼ੁਸ਼', 'khush'), ('કેમ છો', 'kem chho'),
                            ('வணக்கம்', 'vanakkam'), ('தமிழ் வீடு', 'thamizh veedu'), ('ప్రేమ', 'prema'), ('ನಮಸ್ಕಾರ', 'namaskaara'),
                            ('അവൻ', 'avan'), ('ତୋର ମନ', 'tora mana')]:
            self.assertEqual(' '.join(romanized(word) for word in words.split()), said, words)

    def test_the_nasal_sign_is_said_as_its_neighbours_and_language_say_it(self):
        # "m" before p, b and m, and at the end of a Telugu, Kannada or Malayalam word; "ng" in Bengali; otherwise "n".
        for word, said in [('संबंध', 'sambandh'), ('हिंदी', 'hindee'), ('ਅੰਬ', 'amb'), ('అందం', 'andam'),
                           ('മലയാളം', 'malayaalam'), ('ಚಂದ', 'chanda'), ('সংবাদ', 'songbad')]:
            self.assertEqual(romanized(word), said, word)

    def test_tamil_stops_are_voiced_where_tamil_voices_them(self):
        # Voiceless at a word's start and doubled, voiced after a nasal and between vowels; ச is "s" but "j" after a nasal.
        for word, said in [('அன்பு', 'anbu'), ('தங்கம்', 'thangam'), ('மாதம்', 'maadham'), ('மஞ்சள்', 'manjal'), ('ஆசை', 'aasai'),
                           ('சொல்லு', 'sollu'), ('பாடல்', 'paadal'), ('அப்பா', 'appaa'), ('பட்டம்', 'pattam'), ('காற்று', 'kaatru'),
                           ('ஒன்று', 'ondru'), ('வண்டி', 'vandi'), ('கண்ணே', 'kanne')]:
            self.assertEqual(romanized(word), said, word)

    def test_vowel_signs_typed_in_parts_are_read_whole(self):
        # Tamil's ொ and Bengali's ো typed as their two halves, Kannada's ೋ as three, read as the single signs are.
        self.assertEqual(readings('\u0b95\u0bc6\u0bbe'), ['ko', '', ''])
        self.assertEqual(readings('\u0b95\u0bc7\u0bbe'), ['ko', '', ''])
        self.assertEqual(readings('\u0995\u09c7\u09be'), ['ko', '', ''])
        self.assertEqual(readings('\u0c95\u0cc6\u0cc2\u0cd5'), ['ko', '', '', ''])
        # Malayalam writes au with its length mark alone.
        self.assertEqual(romanized('കൗ'), 'kau')

    def test_each_syllable_is_read_on_its_first_character(self):
        self.assertEqual(readings('करना'), ['ka', 'r', 'naa', ''])
        self.assertEqual(readings('प्यार'), ['p', '', 'yaa', '', 'r'])
        self.assertEqual(readings('प्यार', long_vowels=False), ['p', '', 'ya', '', 'r'])
        self.assertEqual(readings('ज़रा'), ['za', 'raa', ''])
        # A two-part vowel sign (Bengali's ো) is read whole, on its consonant.
        self.assertEqual(readings('তো'), ['to', ''])
        # Other characters are kept when romanized.
        self.assertEqual(romanized('दिल,'), 'dil,')


if __name__ == '__main__':
    unittest.main()
