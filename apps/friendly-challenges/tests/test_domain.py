import json
import unittest

from challenges.domain import DomainError
from challenges import domain


class DomainTests(unittest.TestCase):
    def test_duplicate_decoded_keys_and_nested_nonfinite_json_are_rejected(self):
        for raw in ['{"x":1,"\\u0078":2}', '{"x":NaN}', '{"x":Infinity}',
                    '[' * 10000 + '0' + ']' * 10000, '{}x', '\ud800']:
            with self.subTest(raw=raw[:20]), self.assertRaises(DomainError):
                domain.parse_json(raw)
        self.assertEqual(domain.parse_json('{"text":"literal <script>"}'), {'text': 'literal <script>'})

    def test_public_link_syntax_rejects_credentials_and_browser_ip_spellings(self):
        for url in ['https://example.com/evidence#section', 'https://sub.example.org/a%20b#quoted%20text']:
            self.assertEqual(domain.validate_url(url), url)
        for url in ['http://example.com', 'javascript:alert(1)', 'https://user:secret@example.com/',
                    'https://example.com:443/', 'https://example.com/?token=secret',
                    'https://127.0.0.1/', 'https://127.1/', 'https://0x7f.1/', 'https://0177.0.0.1/',
                    'https://example.0x7f/', 'https://0x7f.0x1/', 'https://0x7f000001/',
                    'https://localhost/', 'https://a.local/',
                    'https://a.internal/', 'https://a.test/', 'https://[::1]/',
                    'https://example.com/%0A', 'https://example.com/#%00',
                    'https://example.com/%', 'https://example.com/a\\b', 'https://例.example/',
                    'https://example.com/\n', 'https://example.com/' + 'x' * 1024]:
            with self.subTest(url=url), self.assertRaises(DomainError) as error:
                domain.validate_url(url)
            self.assertNotIn('secret', str(error.exception))
        self.assertIsNone(domain.validate_url(None))

    def test_text_and_terms_are_strict_detached_and_future_only_when_requested(self):
        terms = dict(title='  Test  ', description='A\nB\tC', successCriteria='Finish',
                     evidenceRule='Write a note', stake='bragging-rights', deadline=2000)
        result = domain.validate_terms(terms, 1000)
        self.assertEqual(result['title'], 'Test')
        self.assertEqual(terms['title'], '  Test  ')
        for patch in [dict(deadline=1000), dict(deadline=True), dict(deadline=float('nan')),
                      dict(deadline=1000 + 366 * 86400000), dict(stake='money'),
                      dict(title='x' * 101), dict(description='\ud800'), dict(extra=True)]:
            with self.subTest(patch=patch), self.assertRaises(DomainError):
                domain.validate_terms({**terms, **patch}, 1000)
        self.assertEqual(json.loads(domain.encode_json(result)), result)

    def test_invalid_service_clocks_fail_with_safe_domain_errors(self):
        for value in [True, -1, float('nan'), float('inf'), 10**1000]:
            with self.subTest(value=str(value)[:30]), self.assertRaises(DomainError) as error:
                domain.timestamp(lambda: value)
            self.assertEqual(error.exception.code, 'internal_error')


if __name__ == '__main__':
    unittest.main()
