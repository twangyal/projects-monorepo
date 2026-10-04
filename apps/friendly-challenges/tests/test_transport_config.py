"""Actual TLS key-pair admission without changes to any service library."""

from dataclasses import replace
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from challenges.transport import TransportError, matches_setup, prepare_transport


class TransportConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name)
        cls.cert, cls.key = cls.root / 'cert.pem', cls.root / 'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-keyout', str(cls.key), '-out', str(cls.cert), '-days', '1',
                        '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.key.chmod(0o600)

    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.setup = Path(self.work.name) / 'setup'
        self.setup.write_bytes(b'a' * 64 + b'\n')
        self.setup.chmod(0o600)

    def prepare(self, **changes):
        options = dict(bind='127.0.0.1', port=8443, origin='https://localhost:8443',
                       tls_cert=self.cert, tls_key=self.key, setup_token_file=self.setup)
        options.update(changes)
        return prepare_transport(**options)

    def test_actual_pair_context_and_setup_digest_do_not_expose_key(self):
        config = self.prepare()
        self.assertEqual((config.bind, config.port, config.origin, config.authority),
                         ('127.0.0.1', 8443, 'https://localhost:8443', 'localhost:8443'))
        self.assertEqual(config.ssl_context.protocol, ssl.PROTOCOL_TLS_SERVER)
        self.assertGreaterEqual(config.ssl_context.minimum_version, ssl.TLSVersion.TLSv1_2)
        self.assertTrue(matches_setup(config, 'a' * 64))
        for value in [None, b'a' * 64, 'A' * 64, 'b' * 64, 'a' * 63, 'a' * 64 + '\n', 'é' * 64]:
            self.assertFalse(matches_setup(config, value))
        self.assertNotIn('setup_digest', repr(config))
        self.assertNotIn('ssl_context', repr(config))
        self.assertEqual(self.setup.read_bytes(), b'a' * 64 + b'\n')

    def test_exact_private_address_and_origin_spellings(self):
        for address in ['10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.4.8', '127.0.0.2']:
            self.assertEqual(self.prepare(bind=address, origin=f'https://{address}:8443').bind, address)
        config = self.prepare(port=443, origin='https://music.lan')
        self.assertEqual(config.authority, 'music.lan')
        for address in ['0.0.0.0', '8.8.8.8', '169.254.1.1', '172.32.0.1', '::1', '127.00.0.1', ' 127.0.0.1', 'localhost']:
            with self.subTest(address=address), self.assertRaises(TransportError):
                self.prepare(bind=address)
        for origin in ['https://LOCALHOST:8443', 'http://localhost:8443', 'https://localhost:8443/',
                       'https://localhost:08443', 'https://localhost', 'https://a..b:8443',
                       'https://-a.lan:8443', 'https://localhost.:8443', 'https://127.0.0.2:8443',
                       'https://127.00.0.1:8443', 'https://123:8443', 'https://localhost:8443#x',
                       'https://0x7f.0x1:8443', 'https://0x7f000001:8443',
                       'https://music.0x1:8443', 'https://music.123:8443',
                       'https://x@localhost:8443', 'https://é.lan:8443']:
            with self.subTest(origin=origin), self.assertRaises(TransportError):
                self.prepare(origin=origin)
        for port in [0, 65536, True, 1.5]:
            with self.subTest(port=port), self.assertRaises(TransportError):
                self.prepare(port=port)
        with self.assertRaises(TransportError):
            self.prepare(port=443, origin='https://localhost:443')

    def test_setup_file_exact_bytes_modes_and_symlinks(self):
        for content in [b'', b'a' * 63, b'a' * 66, b'A' * 64, b'a' * 64 + b'\r\n', b'a' * 64 + b' ', b'\xef\xbb\xbf' + b'a' * 64]:
            self.setup.write_bytes(content)
            with self.subTest(size=len(content)), self.assertRaises(TransportError):
                self.prepare()
        self.setup.write_bytes(b'a' * 64)
        self.assertTrue(matches_setup(self.prepare(), 'a' * 64))
        for mode in [0o644, 0o400, 0o1600, 0o4600]:
            self.setup.chmod(mode)
            with self.subTest(mode=mode), self.assertRaises(TransportError):
                self.prepare()
        self.setup.chmod(0o600)
        link = self.setup.with_name('link')
        link.symlink_to(self.setup)
        with self.assertRaises(TransportError):
            self.prepare(setup_token_file=link)
        fifo = self.setup.with_name('pipe')
        os.mkfifo(fifo, 0o600)
        with self.assertRaises(TransportError):
            self.prepare(setup_token_file=fifo)

    def test_bad_and_oversized_pair_files_are_fixed_errors_without_private_paths(self):
        bad = self.setup.with_name('bad-key')
        for content in [b'not a private key', b'x' * (32 * 1024 + 1)]:
            bad.write_bytes(content)
            bad.chmod(0o600)
            with self.assertRaises(TransportError) as raised:
                self.prepare(tls_key=bad)
            self.assertNotIn(str(bad), str(raised.exception))
        bad_cert = self.setup.with_name('bad-cert')
        bad_cert.write_bytes(b'x' * (128 * 1024 + 1))
        with self.assertRaises(TransportError):
            self.prepare(tls_cert=bad_cert)
        link = bad.with_name('key-link')
        link.symlink_to(self.key)
        with self.assertRaises(TransportError):
            self.prepare(tls_key=link)
        # Comparison must remain total even for a structurally invalid trusted config.
        self.assertFalse(matches_setup(replace(self.prepare(), setup_digest=b'x'), 'a' * 64))

    def test_unsupported_https_platform_refuses_before_any_input_read(self):
        with patch('challenges.transport.sys.platform', 'darwin'), patch('challenges.transport._file') as read:
            with self.assertRaisesRegex(TransportError, 'Linux'):
                self.prepare()
            read.assert_not_called()
        with patch('challenges.transport.os.memfd_create', None):
            with self.assertRaisesRegex(TransportError, 'Linux'):
                self.prepare()


if __name__ == '__main__':
    unittest.main()
