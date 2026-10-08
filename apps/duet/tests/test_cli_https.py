"""CLI transport admission is completed before any room library is opened."""

from contextlib import redirect_stderr, redirect_stdout
import io
import errno
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

from duet import __main__ as cli
from duet.transport import TransportError


class HttpsCliTests(unittest.TestCase):
    def invoke(self, arguments, **mocks):
        output, errors = io.StringIO(), io.StringIO()
        server = SimpleNamespace(server_port=12345)
        with patch.object(cli, 'create_server', **mocks) as create, \
                patch.object(cli.signal, 'signal'), \
                patch('sys.argv', ['duet', '--data-dir', 'private-library', *arguments]), \
                redirect_stdout(output), redirect_stderr(errors):
            try:
                cli.main()
            except SystemExit as error:
                code = error.code
            else:
                code = 0
        return code, output.getvalue(), errors.getvalue(), create, server

    def test_default_loopback_keeps_existing_constructor_and_actual_bound_url(self):
        from unittest.mock import Mock
        server = Mock(server_port=12345)
        server.serve_forever.side_effect = KeyboardInterrupt
        code, output, errors, create, _ = self.invoke([], return_value=server)
        self.assertEqual(code, 0)
        create.assert_called_once_with(Path('private-library'), 8766)
        self.assertEqual(output, 'Duet: http://127.0.0.1:12345\n')
        self.assertEqual(errors, '')
        server.server_close.assert_called_once()

    def test_each_partial_configuration_refuses_before_library_or_listener(self):
        for flag in ['--bind', '--origin', '--tls-cert', '--tls-key', '--setup-token-file']:
            with self.subTest(flag=flag):
                code, output, errors, create, _ = self.invoke([flag, 'private-value'])
                self.assertEqual(code, 2)
                self.assertEqual(output, '')
                self.assertIn('together', errors)
                self.assertNotIn('private-value', errors)
                create.assert_not_called()

    def test_complete_options_prepare_before_server_and_print_only_public_origin(self):
        from unittest.mock import Mock
        config = SimpleNamespace(origin='https://duet.example:9443')
        server = Mock()
        server.serve_forever.side_effect = KeyboardInterrupt
        options = ['--port', '9443', '--bind', '127.0.0.1', '--origin', config.origin,
                   '--tls-cert', 'private-certificate', '--tls-key', 'private-key',
                   '--setup-token-file', 'private-setup']
        with patch.object(cli, 'prepare_transport', return_value=config, create=True) as prepare:
            code, output, errors, create, _ = self.invoke(options, return_value=server)
        self.assertEqual(code, 0)
        prepare.assert_called_once_with(bind='127.0.0.1', port=9443, origin=config.origin,
                                       tls_cert=Path('private-certificate'), tls_key=Path('private-key'),
                                       setup_token_file=Path('private-setup'))
        create.assert_called_once_with(Path('private-library'), 9443, transport=config)
        self.assertEqual(output, 'Duet: https://duet.example:9443\n')
        self.assertEqual(errors, '')
        server.server_close.assert_called_once()

    def test_configuration_error_is_bounded_without_traceback_or_library_admission(self):
        options = ['--bind', '127.0.0.1', '--origin', 'https://duet.example:8766',
                   '--tls-cert', 'private-certificate', '--tls-key', 'private-key',
                   '--setup-token-file', 'private-setup']
        with patch.object(cli, 'prepare_transport', side_effect=TransportError('Check TLS certificate and key files.'), create=True):
            code, output, errors, create, _ = self.invoke(options)
        self.assertEqual(code, 2)
        self.assertEqual(output, '')
        self.assertIn('Check TLS certificate and key files.', errors)
        self.assertNotIn('Traceback', errors)
        for private in ['private-certificate', 'private-key', 'private-setup', 'private-library']:
            self.assertNotIn(private, errors)
        create.assert_not_called()

    def test_actual_invalid_tls_file_preserves_library_and_private_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            library = root / 'library'
            library.mkdir()
            original = b'original private library receipt'
            (library / 'rooms.db').write_bytes(original)
            certificate, key, setup = (root / name for name in ['certificate', 'key', 'setup'])
            certificate.write_bytes(b'not a TLS certificate')
            key.write_bytes(b'not a TLS private key')
            setup.write_text('a' * 64, encoding='ascii')
            key.chmod(0o600)
            setup.chmod(0o600)
            arguments = ['--data-dir', str(library), '--bind', '127.0.0.1',
                         '--origin', 'https://duet.example:8766', '--tls-cert', str(certificate),
                         '--tls-key', str(key), '--setup-token-file', str(setup)]
            code, output, errors, create, _ = self.invoke(arguments)
            self.assertEqual(code, 2)
            self.assertEqual(output, '')
            self.assertNotIn(str(root), errors)
            self.assertNotIn('Traceback', errors)
            self.assertNotIn('a' * 64, errors)
            create.assert_not_called()
            self.assertEqual((library / 'rooms.db').read_bytes(), original)
            self.assertEqual({item.name for item in library.iterdir()}, {'rooms.db'})

    def test_https_bind_failures_have_fixed_guidance_without_exception_details(self):
        config = SimpleNamespace(origin='https://duet.example:8766')
        options = ['--bind', '127.0.0.1', '--origin', config.origin,
                   '--tls-cert', 'private-certificate', '--tls-key', 'private-key',
                   '--setup-token-file', 'private-setup']
        for number in [errno.EADDRINUSE, errno.EADDRNOTAVAIL]:
            with self.subTest(errno=number), \
                    patch.object(cli, 'prepare_transport', return_value=config):
                code, output, errors, create, _ = self.invoke(
                    options, side_effect=OSError(number, 'private startup exception detail'))
                self.assertEqual(code, 2)
                self.assertEqual(output, '')
                self.assertIn('bind address', errors)
                self.assertIn('port', errors)
                self.assertNotIn('Traceback', errors)
                self.assertNotIn('private startup exception detail', errors)
                self.assertNotIn('private-library', errors)
                create.assert_called_once()

    def test_default_loopback_startup_oserror_keeps_existing_behavior(self):
        failure = OSError(errno.EADDRINUSE, 'original loopback behavior')
        with self.assertRaises(OSError) as caught:
            self.invoke([], side_effect=failure)
        self.assertIs(caught.exception, failure)


if __name__ == '__main__':
    unittest.main()
