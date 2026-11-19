import unittest
from karaoke.model import create_project
from karaoke.server import KaraokeServer


class ReviewIdentityTests(unittest.TestCase):
    def test_projected_readings_keep_the_identity_of_the_full_original_transcript(self):
        project = create_project('a' * 32, 'Song', 16)
        original = dict(model='fixture', seconds=0.1, language='zh', words=[dict(text='愛', start=3, end=5, confidence=0.9)])
        one = KaraokeServer.transcript_reply(original, project)
        two = KaraokeServer.transcript_reply({**original, 'language': 'yue'}, project)
        self.assertEqual(one['cues'], two['cues'])
        self.assertRegex(one.get('identity', ''), r'^[a-f0-9]{64}$')
        self.assertNotEqual(one['identity'], two['identity'])
        self.assertEqual(one['identity'], KaraokeServer.transcript_reply(dict(original), project)['identity'])
