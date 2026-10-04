"""Original independent requests; real trusted CA/SSL, no production TLS helpers."""
import hashlib
import json
from pathlib import Path
import socket
import ssl
import tempfile
import threading
import time
import unittest

from duet import transport
from duet.server import create_server
from https_oracle_fixtures import certificates, receive, reserve_port, split_response, trusted_context, wire_request


class HttpsProtocolOracle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='duet-tls-oracle-')
        cls.root = Path(cls.temp.name)
        cls.certs = certificates(cls.root / 'certs')

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.case_temp = tempfile.TemporaryDirectory(dir=self.root)
        self.addCleanup(self.case_temp.cleanup)
        self.case = Path(self.case_temp.name)
        self.secret = '93'*32
        self.key = self.case / 'setup'
        self.key.write_text(self.secret+'\n')
        self.key.chmod(0o600)
        self.port = reserve_port()
        self.authority = f'127.0.0.1:{self.port}'
        self.origin = 'https://'+self.authority
        self.dist = self.case / 'dist'
        self.dist.mkdir()
        (self.dist / 'index.html').write_text('<title>Original TLS oracle</title>')
        self.servers = []
        self.addCleanup(self.stop)

    def config(self, **changes):
        fields = dict(bind='127.0.0.1', port=self.port, origin=self.origin,
                      tls_cert=self.certs/'valid.pem', tls_key=self.certs/'server.key',
                      setup_token_file=self.key)
        fields.update(changes)
        return transport.prepare_transport(**fields)

    def start(self, **changes):
        server = create_server(self.case/'library', self.port, dist_dir=self.dist,
                               transport=self.config(**changes))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.servers.append((server, thread))
        return server

    def stop(self):
        for server, thread in reversed(self.servers):
            server.shutdown()
            server.server_close()
            thread.join(6)
            self.assertFalse(thread.is_alive())
        self.servers.clear()

    def connect(self, context=None, name='127.0.0.1'):
        raw = socket.create_connection(('127.0.0.1', self.port), timeout=3)
        try:
            return (context or trusted_context(self.certs)).wrap_socket(raw, server_hostname=name)
        except BaseException:
            raw.close()
            raise

    def request(self, method='GET', path='/api/status', fields=(), body=b''):
        with self.connect() as client:
            client.sendall(wire_request(self.authority, method, path, fields, body))
            return split_response(receive(client))

    def creation(self):
        body = b'{"title":"Original TLS duet","name":"First seat"}'
        status, headers, raw = self.request('POST', '/api/rooms', [
            'Origin: '+self.origin, 'X-Duet-Setup-Key: '+self.secret,
            'Content-Type: application/json', f'Content-Length: {len(body)}'], body)
        self.assertEqual(status, 201)
        return json.loads(raw), headers

    def test_literal_resource_constants(self):
        expected = dict(MAX_CONNECTIONS=16, LISTEN_BACKLOG=16, TLS_HANDSHAKE_SECONDS=5.0,
                        HEADER_SECONDS=10.0, MAX_HEADER_BYTES=16384, MAX_HEADER_FIELDS=64,
                        SOCKET_IDLE_SECONDS=5.0, BODY_SECONDS=30.0, RESPONSE_SECONDS=30.0,
                        CONNECTION_SECONDS=75.0, REQUEST_JOIN_SECONDS=5.0,
                        MAX_CERT_BYTES=131072, MAX_KEY_BYTES=32768, MAX_SETUP_BYTES=65)
        self.assertEqual({key: getattr(transport, key) for key in expected}, expected)

    def test_config_canonical_addresses_and_hidden_digest(self):
        config = self.config()
        self.assertEqual((config.bind, config.port, config.origin, config.authority),
                         ('127.0.0.1', self.port, self.origin, self.authority))
        self.assertEqual(config.setup_digest, hashlib.sha256(self.secret.encode()).digest())
        self.assertNotIn(self.secret, repr(config))
        self.assertNotIn(config.setup_digest.hex(), repr(config))
        self.assertGreaterEqual(config.ssl_context.minimum_version, ssl.TLSVersion.TLSv1_2)
        self.assertTrue(transport.matches_setup(config, self.secret))
        for value in [None, 13, '', self.secret+'\n', 'A'*64, '00'*32]:
            self.assertFalse(transport.matches_setup(config, value))
        for bind in ['0.0.0.0', '8.8.8.8', '169.254.1.2', '224.0.0.1', '127.1',
                     '0177.0.0.1', '127.0.0.01', '0x7f000001', '::1']:
            with self.subTest(bind=bind), self.assertRaises(transport.TransportError):
                self.config(bind=bind)
        for origin in [self.origin+'/', self.origin+'?x', self.origin+'#x',
                       self.origin.replace('https:', 'http:'), 'https://127.1:'+str(self.port),
                       'https://0x7f.0x1:'+str(self.port), 'https://UPPER.example:'+str(self.port),
                       'https://x.example.:'+str(self.port), 'https://x@127.0.0.1:'+str(self.port)]:
            with self.subTest(origin=origin), self.assertRaises(transport.TransportError):
                self.config(origin=origin)

    def test_config_regular_private_files_and_bounds(self):
        for value in [b'a'*63, b'a'*64+b'\r\n', b'a'*64+b'\n\n', b'A'*64, b' '+b'a'*63]:
            self.key.write_bytes(value)
            with self.assertRaises(transport.TransportError):
                self.config()
        self.key.write_text(self.secret+'\n')
        self.key.chmod(0o640)
        with self.assertRaises(transport.TransportError):
            self.config()
        self.key.chmod(0o600)
        link = self.case/'linked-secret'
        link.symlink_to(self.key)
        with self.assertRaises(transport.TransportError):
            self.config(setup_token_file=link)
        key_link = self.case/'linked-key'
        key_link.symlink_to(self.certs/'server.key')
        with self.assertRaises(transport.TransportError):
            self.config(tls_key=key_link)
        huge = self.case/'large-cert'
        huge.write_bytes(b'x'*131073)
        with self.assertRaises(transport.TransportError):
            self.config(tls_cert=huge)
        self.assertFalse((self.case/'library').exists())

    def test_native_ca_hostname_expiry_and_plaintext(self):
        self.start()
        with self.connect() as client:
            self.assertIn(client.version(), ('TLSv1.2', 'TLSv1.3'))
            self.assertIn(client.selected_alpn_protocol(), (None, 'http/1.1'))
        with self.assertRaises(ssl.SSLCertVerificationError):
            self.connect(ssl.create_default_context())
        with self.assertRaises(ssl.SSLCertVerificationError):
            self.connect(name='wrong.invalid')
        with socket.create_connection(('127.0.0.1', self.port), timeout=3) as raw:
            raw.sendall(b'GET /api/status HTTP/1.1\r\nHost: localhost\r\n\r\n')
            self.assertFalse(receive(raw).startswith(b'HTTP/'))
        self.stop()
        for name in ['expired', 'wrong-san']:
            self.start(tls_cert=self.certs/(name+'.pem'))
            with self.assertRaises(ssl.SSLCertVerificationError):
                self.connect()
            self.stop()

    def test_public_status_and_connection_close(self):
        self.start()
        status, headers, raw = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['transport'],
                         dict(mode='https-lan', origin=self.origin, setupRequired=True))
        self.assertIn(b'connection: close', [h.lower() for h in headers])
        self.assertIn(b'cache-control: no-store', [h.lower() for h in headers])
        self.assertNotIn(self.secret.encode(), raw)
        self.assertNotIn(str(self.case).encode(), raw)

    def test_setup_rejected_before_body_and_not_participant_authority(self):
        self.start()
        for fields in [[], ['X-Duet-Setup-Key: '+'00'*32], ['X-Duet-Setup-Key: '+self.secret]*2]:
            status, _, _ = self.request('POST', '/api/rooms', [
                'Origin: '+self.origin, 'Content-Type: application/json',
                'Content-Length: 64000', *fields])
            self.assertIn(status, (400, 401, 403))
        room, headers = self.creation()
        cookies = [line.decode() for line in headers if line.lower().startswith(b'set-cookie:')]
        self.assertEqual(len(cookies), 1)
        for part in ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/api/rooms/'+room['roomId']]:
            self.assertIn(part, cookies[0])
        endpoint = '/api/rooms/'+room['roomId']
        for fields in [['X-Duet-Setup-Key: '+self.secret],
                       ['Cookie: '+cookies[0].split(': ', 1)[1].split(';', 1)[0]]]:
            self.assertEqual(self.request(path=endpoint, fields=fields)[0], 401)
        status, _, raw = self.request(path=endpoint, fields=['Authorization: Bearer '+room['token']])
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['myRole'], 'host')

    def test_authority_duplicates_proxy_and_framing_before_body(self):
        self.start()
        cases = [['Host: '+self.authority], ['Origin: '+self.origin]*2,
                 ['Origin: https://wrong.invalid'], ['Sec-Fetch-Site: cross-site'],
                 ['Sec-Fetch-Site: same-origin']*2, ['Forwarded: host=wrong.invalid'],
                 ['X-Forwarded-For: 127.0.0.1'], ['Transfer-Encoding: chunked'],
                 ['Content-Length: 1'], ['Authorization: Bearer '+'a'*64]*2]
        for index, fields in enumerate(cases):
            with self.subTest(case=index):
                self.assertIn(self.request(fields=fields)[0], (400, 401, 403, 421))
        for fields in [[], ['Origin: https://wrong.invalid'],
                       ['Origin: '+self.origin, 'Content-Type: application/json',
                        'Content-Type: application/json']]:
            self.assertIn(self.request('POST', '/api/rooms', [*fields,
                'X-Duet-Setup-Key: '+self.secret, 'Content-Length: 64000'])[0], (400, 401, 403, 415))

    def test_exact_header_bytes_and_fields(self):
        self.start()
        count = 16384-len(wire_request(self.authority))-len(b'X-Oracle: \r\n')
        exact = wire_request(self.authority, fields=['X-Oracle: '+'v'*count])
        self.assertEqual(len(exact), 16384)
        with self.connect() as client:
            client.sendall(exact)
            self.assertEqual(split_response(receive(client))[0], 200)
        with self.connect() as client:
            client.sendall(exact.replace(b'X-Oracle: ', b'X-Oracle: v', 1))
            self.assertNotEqual(split_response(receive(client))[0], 200)
        self.assertEqual(self.request(fields=[f'X-Oracle-{i}: x' for i in range(63)])[0], 200)
        self.assertNotEqual(self.request(fields=[f'X-Oracle-{i}: x' for i in range(64)])[0], 200)

    def test_prefetched_body_excluded_and_one_request_pipeline(self):
        self.start()
        body = b'{"title":"Original body","name":"Seat"}'
        first = wire_request(self.authority, 'POST', '/api/rooms', [
            'Origin: '+self.origin, 'X-Duet-Setup-Key: '+self.secret,
            'Content-Type: application/json', f'Content-Length: {len(body)}'], body)
        sep = first.index(b'\r\n\r\n')
        first = first[:sep]+b'\r\nX-Pad: '+b'x'*(16384-(sep+4)-len(b'X-Pad: \r\n'))+first[sep:]
        self.assertEqual(first.index(b'\r\n\r\n')+4, 16384)
        with self.connect() as client:
            client.sendall(first+wire_request(self.authority))
            data = receive(client)
        self.assertEqual(split_response(data)[0], 201)
        self.assertEqual(data.count(b'HTTP/1.1 '), 1)

    def test_actual_five_second_handshake_and_shutdown_lock_release(self):
        server = self.start()
        raw = socket.create_connection(('127.0.0.1', self.port), timeout=8)
        self.addCleanup(raw.close)
        start = time.monotonic()
        self.assertEqual(raw.recv(1), b'')
        elapsed = time.monotonic()-start
        self.assertGreaterEqual(elapsed, 4.5)
        self.assertLess(elapsed, 7.5)
        stalled = socket.create_connection(('127.0.0.1', self.port), timeout=3)
        header = self.connect()
        self.addCleanup(stalled.close)
        self.addCleanup(header.close)
        header.sendall(b'GET /api/status HTTP/1.1\r\nHost: ')
        server.shutdown()
        server.server_close()
        self.assertEqual(receive(stalled), b'')
        self.assertEqual(receive(header), b'')
        other = create_server(self.case/'library', 0, dist_dir=self.dist)
        other.server_close()

    def test_bad_port_or_occupied_listener_cannot_create_library(self):
        config = self.config()
        with self.assertRaises((ValueError, OSError)):
            create_server(self.case/'library', 0, dist_dir=self.dist, transport=config)
        self.assertFalse((self.case/'library').exists())
        with socket.socket() as occupied:
            occupied.bind(('127.0.0.1', self.port))
            occupied.listen(1)
            with self.assertRaises(OSError):
                create_server(self.case/'library', self.port, dist_dir=self.dist, transport=config)
        self.assertFalse((self.case/'library').exists())

    def test_sixteen_verified_tls_connections_saturate_then_recover(self):
        self.start()
        clients = []
        self.addCleanup(lambda: [client.close() for client in clients])
        # Completed verified handshakes prove each slot is admitted, not just TCP backlog.
        for _ in range(16):
            client = self.connect()
            client.sendall(b'GET /api/status HTTP/1.1\r\nHost: ')
            clients.append(client)
        with self.assertRaises((ssl.SSLError, OSError)):
            self.connect()
        clients.pop().close()
        deadline = time.monotonic()+3
        while True:
            try:
                status, _, _ = self.request()
                break
            except (OSError, ssl.SSLError):
                if time.monotonic() >= deadline:
                    raise
                threading.Event().wait(.02)
        self.assertEqual(status, 200)

    def test_actual_ten_second_trickled_single_header_deadline(self):
        self.start()
        client = self.connect()
        self.addCleanup(client.close)
        client.settimeout(13)
        client.sendall(b'GET /api/status HTTP/1.1\r\nHost: '+self.authority.encode()+b'\r\nX-Slow: ')
        done = threading.Event()
        def trickle():
            while not done.wait(.2):
                try:
                    client.sendall(b'x')
                except OSError:
                    return
        sender = threading.Thread(target=trickle, daemon=True)
        start = time.monotonic()
        sender.start()
        try:
            data = receive(client)
        finally:
            done.set()
            sender.join(2)
        self.assertFalse(sender.is_alive())
        self.assertNotEqual(split_response(data)[0], 200)
        elapsed = time.monotonic()-start
        self.assertGreaterEqual(elapsed, 9.0)
        self.assertLess(elapsed, 12.5)

    def test_real_audio_scoped_cookies_ranges_and_one_use_invitation(self):
        import io
        import math
        import struct
        import wave
        self.start()
        room, headers = self.creation()
        endpoint = '/api/rooms/'+room['roomId']
        host_cookie = next(h.decode().split(': ', 1)[1].split(';', 1)[0]
                           for h in headers if h.lower().startswith(b'set-cookie:'))
        body = json.dumps({'inviteToken': room['inviteToken'], 'name': 'Second seat'}).encode()
        fields = ['Origin: '+self.origin, 'Content-Type: application/json',
                  f'Content-Length: {len(body)}']
        status, _, raw = self.request('POST', endpoint+'/join', fields, body)
        self.assertEqual(status, 200)
        guest = json.loads(raw)['token']
        self.assertEqual(self.request('POST', endpoint+'/join', fields, body)[0], 409)
        self.assertEqual(self.request(path=endpoint,
            fields=['Authorization: Bearer '+guest])[0], 200)
        sound = io.BytesIO()
        with wave.open(sound, 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(b''.join(struct.pack('<h', round(7000*math.sin(i*2*math.pi*440/16000)))
                                     for i in range(16000)))
        audio = sound.getvalue()
        status, _, raw = self.request('POST', endpoint+'/tracks', [
            'Origin: '+self.origin, 'Authorization: Bearer '+room['token'],
            'X-Track-Title: Original%20oracle%20tone', f'Content-Length: {len(audio)}'], audio)
        self.assertEqual(status, 202)
        job = json.loads(raw)['job']
        deadline = time.monotonic()+12
        while job['status'] == 'running':
            self.assertLess(time.monotonic(), deadline, 'Original one-second PCM conversion stalled')
            _, _, raw = self.request(path=endpoint+'/jobs/'+job['id'],
                                    fields=['Authorization: Bearer '+room['token']])
            job = json.loads(raw)['job']
            if job['status'] == 'running':
                threading.Event().wait(.02)
        self.assertEqual(job['status'], 'complete')
        path = endpoint+'/tracks/'+job['trackId']+'/audio'
        status, _, full = self.request(path=path, fields=['Cookie: '+host_cookie])
        self.assertEqual(status, 200)
        self.assertTrue(full.startswith(b'OggS'))
        self.assertGreater(len(full), 128)
        status, headers, partial = self.request(path=path,
            fields=['Cookie: '+host_cookie, 'Range: bytes=17-127'])
        self.assertEqual(status, 206)
        self.assertEqual(partial, full[17:128])
        self.assertIn(f'content-range: bytes 17-127/{len(full)}'.encode(),
                      [h.lower() for h in headers])
        self.assertEqual(self.request(path=path, fields=['Cookie: '+host_cookie]*2)[0], 400)
        self.assertEqual(self.request(path=path)[0], 401)
        other, _ = self.creation()
        self.assertEqual(self.request(path=path,
            fields=['Authorization: Bearer '+other['token']])[0], 401)

    def test_existing_playback_and_raw_database_unchanged_when_bind_fails(self):
        old = create_server(self.case/'library', 0, dist_dir=self.dist)
        try:
            room = old.store.create_room('Original playing seat', 'Host')
            track = 'a'*32
            old.store.add_track(room['roomId'], room['token'], track, 'Original', '', 100)
            old.store.set_playlist(room['roomId'], room['token'], [track], 0)
            old.store.set_playback(room['roomId'], room['token'], track, True, 7, 0)
        finally:
            old.server_close()
        before = {str(p.relative_to(self.case/'library')): p.read_bytes()
                  for p in (self.case/'library').rglob('*') if p.is_file()}
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', self.port))
            listener.listen(1)
            with self.assertRaises(OSError):
                create_server(self.case/'library', self.port, dist_dir=self.dist,
                              transport=self.config())
        after = {str(p.relative_to(self.case/'library')): p.read_bytes()
                 for p in (self.case/'library').rglob('*') if p.is_file()}
        self.assertEqual(after, before)

    def test_valid_private_dns_443_and_exact_regular_file_limits(self):
        for bind in ['10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.1.7', '127.0.0.2']:
            config = self.config(bind=bind, origin=f'https://duet.local:{self.port}')
            self.assertEqual(config.bind, bind)
        self.assertEqual(self.config(port=443, origin='https://duet.local').authority, 'duet.local')
        with self.assertRaises(transport.TransportError):
            self.config(port=443, origin='https://duet.local:443')
        cert = self.case/'padded-cert'
        original = (self.certs/'valid.pem').read_bytes()
        cert.write_bytes(original+b'\n'*(131072-len(original)))
        self.assertEqual(self.config(tls_cert=cert).authority, self.authority)
        cert.write_bytes(cert.read_bytes()+b'\n')
        with self.assertRaises(transport.TransportError):
            self.config(tls_cert=cert)
        private = self.case/'private-key'
        private.write_bytes((self.certs/'server.key').read_bytes())
        private.chmod(0o640)
        with self.assertRaises(transport.TransportError):
            self.config(tls_key=private)
        private.chmod(0o4600)
        with self.assertRaises(transport.TransportError):
            self.config(tls_key=private)

    def test_malformed_request_forms_controls_and_unsupported_expect(self):
        self.start()
        messages = [
            wire_request(self.authority, path='https://example.invalid/api/status'),
            wire_request(self.authority, method='CONNECT', path=self.authority),
            wire_request(self.authority, fields=['Upgrade: websocket', 'Connection: Upgrade']),
            wire_request(self.authority).replace(b'HTTP/1.1', b'HTTP/9.9'),
            wire_request(self.authority, fields=['Bad Name: value']),
            wire_request(self.authority, fields=['X-Control: a\x01b']),
            wire_request(self.authority, 'POST', '/api/rooms', [
                'Origin: '+self.origin, 'X-Duet-Setup-Key: '+self.secret,
                'Content-Length: 64000', 'Expect: 100-continue']),
        ]
        for index, message in enumerate(messages):
            with self.subTest(case=index), self.connect() as client:
                client.sendall(message)
                raw = receive(client)
                self.assertNotIn(split_response(raw)[0], (100, 200, 201, 202))
                self.assertNotIn(b'100 Continue', raw)

    def test_scaled_body_and_total_deadline_branches_use_real_tls(self):
        from unittest.mock import patch
        for name in ['BODY_SECONDS', 'CONNECTION_SECONDS']:
            with self.subTest(scaled=name), patch.object(transport, name, .6):
                self.start()
                client = self.connect()
                self.addCleanup(client.close)
                start = time.monotonic()
                if name == 'BODY_SECONDS':
                    client.sendall(wire_request(self.authority, 'POST', '/api/rooms', [
                        'Origin: '+self.origin, 'X-Duet-Setup-Key: '+self.secret,
                        'Content-Type: application/json', 'Content-Length: 64000'], b'{'))
                else:
                    client.sendall(b'GET /api/status HTTP/1.1\r\nX-Pending: ')
                raw = receive(client)
                elapsed = time.monotonic()-start
                self.assertNotIn(split_response(raw)[0], (200, 201))
                self.assertGreaterEqual(elapsed, .4)
                self.assertLess(elapsed, 2.0)
                self.stop()

    def test_scaled_join_refusal_keeps_actual_directory_lock_until_worker_exits(self):
        from unittest.mock import patch
        server = self.start()
        room, _ = self.creation()
        entered, release = threading.Event(), threading.Event()
        original = server.store.snapshot
        def held_snapshot(*args, **kwargs):
            entered.set()
            if not release.wait(8):
                raise RuntimeError('Independent held-request fixture expired')
            return original(*args, **kwargs)
        client = self.connect()
        self.addCleanup(client.close)
        self.addCleanup(release.set)
        with patch.object(server.store, 'snapshot', held_snapshot), \
                patch.object(transport, 'REQUEST_JOIN_SECONDS', .15):
            client.sendall(wire_request(self.authority, path='/api/rooms/'+room['roomId'],
                                       fields=['Authorization: Bearer '+room['token']]))
            self.assertTrue(entered.wait(3), 'Real TLS request did not reach held Store boundary')
            server.shutdown()
            try:
                with self.assertRaises(RuntimeError):
                    server.server_close()
                with self.assertRaises((RuntimeError, OSError)):
                    create_server(self.case/'library', 0, dist_dir=self.dist)
            finally:
                release.set()
        # Real request finishes after its boundary release; repeated close may retire ownership.
        deadline = time.monotonic()+3
        while True:
            try:
                server.server_close()
                break
            except RuntimeError:
                if time.monotonic() >= deadline:
                    raise
                threading.Event().wait(.02)
        other = create_server(self.case/'library', 0, dist_dir=self.dist)
        other.server_close()

    def test_eight_mib_transport_range_exact_bytes_and_scaled_backpressure(self):
        """Opaque original byte fixture tests transport only; real codec tested separately."""
        from unittest.mock import patch
        server = self.start()
        room, _ = self.creation()
        track = 'd'*32
        payload = (bytes(range(251))*33421)[:8*1024*1024]
        self.assertEqual(len(payload), 8*1024*1024)
        folder = server.media_dir / room['roomId']
        folder.mkdir(exist_ok=True)
        (folder/(track+'.ogg')).write_bytes(payload)
        server.store.add_track(room['roomId'], room['token'], track, 'Opaque transport bytes', '', 1)
        path = '/api/rooms/'+room['roomId']+'/tracks/'+track+'/audio'
        status, headers, actual = self.request(path=path, fields=[
            'Authorization: Bearer '+room['token'], 'Range: bytes=0-8388607'])
        self.assertEqual(status, 206)
        self.assertEqual(actual, payload)
        self.assertIn(b'content-length: 8388608', [h.lower() for h in headers])
        raw = socket.socket()
        raw.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024)
        raw.settimeout(3)
        raw.connect(('127.0.0.1', self.port))
        client = trusted_context(self.certs).wrap_socket(raw, server_hostname='127.0.0.1')
        self.addCleanup(client.close)
        with patch.object(transport, 'RESPONSE_SECONDS', .2):
            client.sendall(wire_request(self.authority, path=path, fields=[
                'Authorization: Bearer '+room['token'], 'Range: bytes=0-8388607']))
            # Read only the header; body backpressure comes from native small TCP receive window.
            header = b''
            while not header.endswith(b'\r\n\r\n'):
                header += client.recv(1)
                self.assertLess(len(header), 16384)
            self.assertEqual(split_response(header)[0], 206)
            # A fully occupied16-slot pool must become available after response expiry.
            holders = [self.connect() for _ in range(15)]
            self.addCleanup(lambda: [holder.close() for holder in holders])
            deadline = time.monotonic()+2
            while True:
                try:
                    status, _, _ = self.request()
                    break
                except (OSError, ssl.SSLError):
                    if time.monotonic() >= deadline:
                        raise
                    threading.Event().wait(.02)
            self.assertEqual(status, 200)
            for holder in holders:
                holder.close()
