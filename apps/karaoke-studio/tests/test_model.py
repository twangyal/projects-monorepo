import math
import unittest

from karaoke.model import (ValidationError, create_project, draft_cues, render_srt,
                           update_project, validate_project)


class ModelTests(unittest.TestCase):
    def project(self):
        return create_project('a' * 32, 'A song', 3)

    def test_create_and_validation_reconstruct_known_fields(self):
        project = self.project()
        self.assertEqual(project, dict(schemaVersion=1, id='a' * 32, title='A song',
                                       duration=3.0, revision=0, cues=[]))
        project['untrusted'] = {'extra': True}
        project['cues'] = [dict(start=0, end=1, text='<b>literal</b>', unknown='drop')]
        safe = validate_project(project)
        self.assertNotIn('untrusted', safe)
        self.assertNotIn('unknown', safe['cues'][0])
        safe['cues'][0]['text'] = 'changed'
        self.assertEqual(project['cues'][0]['text'], '<b>literal</b>')

    def test_invalid_fields_and_nonfinite_numbers_are_rejected(self):
        cases = [('id', '../unsafe'), ('id', 'A' * 32), ('schemaVersion', 2),
                 ('schemaVersion', True), ('title', ''), ('title', ' '),
                 ('title', 'a' * 101), ('title', '\ud800'), ('duration', 0.9), ('duration', 30.1),
                 ('duration', math.nan), ('duration', math.inf), ('duration', True),
                 ('revision', True), ('revision', -1), ('cues', 'not a list')]
        for key, value in cases:
            with self.subTest(key=key, value=value), self.assertRaises(ValidationError):
                validate_project({**self.project(), key: value})

    def test_cue_intervals_and_text_are_validated(self):
        for cues in [[dict(start=1, end=1, text='x')], [dict(start=-1, end=1, text='x')],
                     [dict(start=0, end=4, text='x')], [dict(start=0, end=1, text='')],
                     [dict(start=0, end=1, text='x' * 241)],
                     [dict(start=0, end=2, text='x'), dict(start=1, end=3, text='y')],
                     [dict(start=0, end=math.inf, text='x')],
                     [dict(start=False, end=1, text='x')],
                     [dict(start=0, end=1, text='bad\x00text')]]:
            with self.subTest(cues=cues), self.assertRaises(ValidationError):
                validate_project({**self.project(), 'cues': cues})

    def test_adjacent_cues_and_gaps_are_valid(self):
        cues = [dict(start=0, end=1, text='One'), dict(start=1, end=1.5, text='Two'),
                dict(start=2, end=3, text='Three')]
        self.assertEqual(validate_project({**self.project(), 'cues': cues})['cues'], cues)

    def test_update_is_atomic_and_requires_current_revision(self):
        original = self.project()
        updated = update_project(original, 'New title', [dict(start=0, end=1, text='First')], 0)
        self.assertEqual(updated['revision'], 1)
        self.assertEqual(original, self.project())
        with self.assertRaisesRegex(ValidationError, 'revision'):
            update_project(updated, 'Old write', [], 0)
        with self.assertRaises(ValidationError):
            update_project(updated, 'Broken', [dict(start=0, end=10, text='x')], 1)
        self.assertEqual(updated['title'], 'New title')

    def test_draft_timings_are_even_and_ignore_blank_lines(self):
        self.assertEqual(draft_cues('First\n\n Second \r\nThird', 3),
                         [dict(start=0.0, end=1.0, text='First'),
                          dict(start=1.0, end=2.0, text='Second'),
                          dict(start=2.0, end=3.0, text='Third')])
        self.assertEqual(draft_cues('   ', 3), [])

    def test_draft_and_saved_lyrics_have_count_and_character_limits(self):
        for text in ['x\n' * 41, 'x' * 241, '\n'.join(['x' * 200] * 26)]:
            with self.subTest(length=len(text)), self.assertRaises(ValidationError):
                draft_cues(text, 3)
        cues = [dict(start=i / 20, end=(i + 1) / 20, text='x') for i in range(41)]
        with self.assertRaises(ValidationError):
            validate_project({**self.project(), 'cues': cues})

    def test_srt_escapes_markup_and_prevents_extra_subtitle_blocks(self):
        project = update_project(self.project(), 'Song', [dict(start=0.25, end=1.75,
                                 text='<font color="red">Hello & bye</font>\n\n99\n00:00:00,000 --> 00:00:01,000')], 0)
        result = render_srt(project)
        self.assertTrue(result.startswith('1\n00:00:00,250 --> 00:00:01,750\n'))
        self.assertIn('&lt;font color="red"&gt;Hello &amp; bye&lt;/font&gt;', result)
        self.assertNotIn('\n\n99\n', result)
        self.assertNotIn('<font', result)
        self.assertEqual(render_srt(self.project()), '')


if __name__ == '__main__':
    unittest.main()
