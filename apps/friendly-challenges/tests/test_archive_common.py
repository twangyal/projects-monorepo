import time
from threading import Event
import unittest

from challenges.archive_common import ArchiveError, canonical_json, check_archive, parse_json


class ArchiveCommonTests(unittest.TestCase):
    def test_cancellation_precedes_timeout_and_code_is_readonly(self):
        cancel = Event()
        check_archive(cancel, time.monotonic() + 30)
        cancel.set()
        with self.assertRaises(ArchiveError) as caught:
            check_archive(cancel, 0)
        self.assertEqual(caught.exception.code, 'cancelled')
        with self.assertRaises(AttributeError):
            caught.exception.code = 'timeout'
        with self.assertRaises(ArchiveError) as caught:
            check_archive(Event(), 0)
        self.assertEqual(caught.exception.code, 'timeout')
        for invalid in (True, float('nan'), float('inf'), 'later', 10**1000):
            with self.subTest(deadline=invalid), self.assertRaises(ArchiveError):
                check_archive(Event(), invalid)

    def test_literal_utf8_canonical_and_exact_bound(self):
        raw = b' { "z": [1, true, null], "a": "literal \\uD83C\\uDFB5\\n" } '
        parsed = parse_json(raw, len(raw), cancel=Event(), deadline=time.monotonic() + 30)
        self.assertEqual(parsed, {'z': [1, True, None], 'a': 'literal 🎵\n'})
        self.assertEqual(canonical_json(parsed), '{"a":"literal 🎵\\n","z":[1,true,null]}'.encode())
        with self.assertRaises(ArchiveError):
            parse_json(raw, len(raw) - 1, cancel=Event(), deadline=time.monotonic() + 30)

    def test_duplicate_unicode_number_and_depth_rejection(self):
        invalid = [b'{"x":1,"\\u0078":2}', b'NaN', b'1e400', b'9007199254740992',
                   b'"\\u0000"', b'"\\ud800"', b'"\xff"', b'\xef\xbb\xbf{}',
                   b'[' * 33 + b'0' + b']' * 33]
        for raw in invalid:
            with self.subTest(raw=raw), self.assertRaises(ArchiveError):
                parse_json(raw, 4096, cancel=Event(), deadline=time.monotonic() + 30)
        raw = b'[' * 32 + b'0' + b']' * 32
        parse_json(raw, 4096, cancel=Event(), deadline=time.monotonic() + 30)
        for value in (float('inf'), '\ud800', '\0', 2**53):
            with self.subTest(value=repr(value)), self.assertRaises(ArchiveError):
                canonical_json(value)
