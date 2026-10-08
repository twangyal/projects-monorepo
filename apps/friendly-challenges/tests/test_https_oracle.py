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

from challenges import transport
from challenges.server import create_server
from https_oracle_fixtures import certificates, receive, reserve_port, split_response, trusted_context, wire_request


class HttpsProtocolOracle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='friendly-tls-oracle-')
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
                               transport=self.config(**changes), now=lambda: 1900000000.0)
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


    def test_literal_resource_constants(self):
        expected = dict(MAX_CONNECTIONS=16, LISTEN_BACKLOG=16, TLS_HANDSHAKE_SECONDS=5.0,
                        HEADER_SECONDS=10.0, MAX_HEADER_BYTES=16384, MAX_HEADER_FIELDS=64,
                        SOCKET_IDLE_SECONDS=5.0, BODY_SECONDS=15.0, RESPONSE_SECONDS=30.0,
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
            self.assertIn(self.request('POST', '/api/challenges', [*fields,
                'X-Friendly-Setup-Key: '+self.secret, 'Content-Length: 16000'])[0], (400, 401, 403, 415))

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



    def test_valid_private_dns_443_and_exact_regular_file_limits(self):
        for bind in ['10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.1.7', '127.0.0.2']:
            config = self.config(bind=bind, origin=f'https://friendly.local:{self.port}')
            self.assertEqual(config.bind, bind)
        self.assertEqual(self.config(port=443, origin='https://friendly.local').authority, 'friendly.local')
        with self.assertRaises(transport.TransportError):
            self.config(port=443, origin='https://friendly.local:443')
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
            wire_request(self.authority, 'POST', '/api/challenges', [
                'Origin: '+self.origin, 'X-Friendly-Setup-Key: '+self.secret,
                'Content-Length: 16000', 'Expect: 100-continue']),
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
                    client.sendall(wire_request(self.authority, 'POST', '/api/challenges', [
                        'Origin: '+self.origin, 'X-Friendly-Setup-Key: '+self.secret,
                        'Content-Type: application/json', 'Content-Length: 16000'], b'{'))
                else:
                    client.sendall(b'GET /api/status HTTP/1.1\r\nX-Pending: ')
                try:
                    raw = receive(client)
                    elapsed = time.monotonic()-start
                    self.assertNotIn(split_response(raw)[0], (200, 201))
                    self.assertGreaterEqual(elapsed, .4)
                    self.assertLess(elapsed, 2.0)
                finally:
                    client.close()
                    self.stop()



    def creation(self):
        from https_oracle_fixtures import original_terms
        payload = {'name': 'Original proposer', 'terms': original_terms()}
        status, headers, raw = self.json_request('POST', '/api/challenges', payload,
                                               setup=True)
        self.assertEqual(status, 201)
        self.assertFalse(any(h.lower().startswith(b'set-cookie:') for h in headers))
        created = json.loads(raw)
        self.assertEqual(created['challenge']['revision'], 1)
        self.assertEqual(created['challenge']['status'], 'proposed')
        self.assertEqual(created['challenge']['terms'], original_terms())
        return created

    def json_request(self, method, path, value=None, token=None, setup=False):
        body = json.dumps(value, ensure_ascii=False).encode() if value is not None else b''
        fields = []
        if method == 'POST':
            fields += ['Origin: '+self.origin, 'Content-Type: application/json',
                       f'Content-Length: {len(body)}']
        if token:
            fields += ['Authorization: Bearer '+token]
        if setup:
            fields += ['X-Friendly-Setup-Key: '+self.secret]
        return self.request(method, path, fields, body)

    def active(self):
        created = self.creation()
        endpoint = '/api/challenges/'+created['challengeId']
        status, _, raw = self.json_request('POST', endpoint+'/join',
            {'inviteToken': created['inviteToken'], 'name': 'Original opponent'})
        self.assertEqual(status, 200)
        guest = json.loads(raw)
        self.assertEqual(guest['challenge']['revision'], 2)
        self.assertEqual(guest['challenge']['status'], 'proposed')
        self.assertIsNone(guest['challenge']['acceptedAt'])
        status, _, raw = self.json_request('POST', endpoint+'/accept',
            {'revision': 2, 'termsVersion': 1}, guest['token'])
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['revision'], 3)
        self.assertEqual(json.loads(raw)['status'], 'active')
        return created, guest, endpoint

    def test_friendly_status_and_setup_before_body_no_cookie_authority(self):
        self.start()
        status, headers, raw = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw), {'schemaVersion': 1, 'maxChallenges': 20,
            'transport': {'mode': 'https-lan', 'origin': self.origin, 'setupRequired': True}})
        self.assertIn(b'connection: close', [h.lower() for h in headers])
        for fields in [[], ['X-Friendly-Setup-Key: '+'00'*32],
                       ['X-Friendly-Setup-Key: '+self.secret]*2]:
            status, _, raw = self.request('POST', '/api/challenges', [
                'Origin: '+self.origin, 'Content-Type: application/json',
                'Content-Length: 16000', *fields])
            self.assertIn(status, (400, 401, 403))
            self.assertEqual(set(json.loads(raw)), {'error', 'code'})
        created = self.creation()
        endpoint = '/api/challenges/'+created['challengeId']
        for fields in [[], ['X-Friendly-Setup-Key: '+self.secret],
                       ['Cookie: seat='+created['token']],
                       ['Authorization: Bearer '+created['inviteToken']]]:
            status, _, raw = self.request(path=endpoint, fields=fields)
            self.assertEqual(status, 401)
            self.assertEqual(set(json.loads(raw)), {'error', 'code'})
        status, _, raw = self.json_request('GET', endpoint, token=created['token'])
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['myRole'], 'proposer')
        for secret in [self.secret, created['token'], created['inviteToken']]:
            self.assertNotIn(secret.encode(), raw)

    def test_claim_is_not_acceptance_and_stale_terms_consent_never_replays(self):
        from https_oracle_fixtures import original_terms
        self.start()
        created = self.creation()
        endpoint = '/api/challenges/'+created['challengeId']
        join = {'inviteToken': created['inviteToken'], 'name': 'Original opponent'}
        status, _, raw = self.json_request('POST', endpoint+'/join', join)
        self.assertEqual(status, 200)
        guest = json.loads(raw)
        self.assertEqual(guest['challenge']['status'], 'proposed')
        self.assertEqual(self.json_request('POST', endpoint+'/join', join)[0], 404)
        changed = {**original_terms(), 'successCriteria': 'Opponent records three completed laps'}
        status, _, raw = self.json_request('POST', endpoint+'/terms',
            {'revision': 2, 'terms': changed}, created['token'])
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['termsVersion'], 2)
        for stale in [{'revision': 2, 'termsVersion': 1}, {'revision': 3, 'termsVersion': 1}]:
            self.assertEqual(self.json_request('POST', endpoint+'/accept', stale, guest['token'])[0], 409)
        status, _, raw = self.json_request('POST', endpoint+'/accept',
            {'revision': 3, 'termsVersion': 2}, guest['token'])
        self.assertEqual(status, 200)
        actual = json.loads(raw)
        self.assertEqual((actual['status'], actual['revision'], actual['terms']), ('active', 4, changed))
        self.assertEqual([event['kind'] for event in actual['events']],
                         ['created', 'opponent_joined', 'terms_edited', 'accepted'])

    def test_literal_jpeg_bearer_only_full_bytes_export_and_same_port_restart(self):
        import base64
        from https_oracle_fixtures import original_jpeg, image_frame
        server = self.start()
        created, guest, endpoint = self.active()
        jpeg = original_jpeg()
        payload = image_frame({'revision': 3, 'text': 'Original <finish> & photograph Ω',
                               'url': None}, jpeg)
        fields = ['Origin: '+self.origin, 'Authorization: Bearer '+guest['token'],
                  'Content-Type: application/octet-stream', f'Content-Length: {len(payload)}']
        status, _, raw = self.request('POST', endpoint+'/evidence/image', fields, payload)
        self.assertEqual(status, 200)
        challenge = json.loads(raw)
        self.assertEqual(challenge['revision'], 4)
        self.assertEqual([e['kind'] for e in challenge['events']],
                         ['created', 'opponent_joined', 'accepted', 'evidence_image_added'])
        entry = challenge['evidence'][0]
        self.assertEqual(entry['image'], dict(mime='image/jpeg', bytes=len(jpeg), width=31,
                                             height=19, sha256=hashlib.sha256(jpeg).hexdigest()))
        self.assertEqual((entry['text'], entry['author'], entry['late']),
                         ('Original <finish> & photograph Ω', 'opponent', False))
        image_path = endpoint+'/evidence/'+entry['id']+'/image'
        for token in [created['token'], guest['token']]:
            status, headers, actual = self.request(path=image_path,
                fields=['Authorization: Bearer '+token])
            self.assertEqual((status, actual), (200, jpeg))
            self.assertIn(b'content-type: image/jpeg', [h.lower() for h in headers])
            self.assertFalse(any(h.lower().startswith(b'set-cookie:') for h in headers))
        for fields in [[], ['Cookie: seat='+guest['token']],
                       ['X-Friendly-Setup-Key: '+self.secret],
                       ['Authorization: Bearer '+created['inviteToken']]]:
            self.assertEqual(self.request(path=image_path, fields=fields)[0], 401)
        other = self.creation()
        self.assertEqual(self.request(path=image_path,
            fields=['Authorization: Bearer '+other['token']])[0], 401)
        status, _, exported = self.json_request('GET', endpoint+'/export', token=guest['token'])
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(exported)['challenge']['evidence'], challenge['evidence'])
        status, headers, html = self.request(path=endpoint+'/export/images',
            fields=['Authorization: Bearer '+guest['token']])
        self.assertEqual(status, 200)
        self.assertIn(base64.b64encode(jpeg), html)
        self.assertIn('Original &lt;finish&gt; &amp; photograph Ω'.encode(), html)
        self.assertNotIn(b'<script', html.lower())
        for token in [self.secret, created['token'], guest['token'], created['inviteToken']]:
            self.assertNotIn(token.encode(), exported+html)
        self.assertEqual(server.socket.getsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR), 1)
        self.stop()
        # Actual TLS request produced a closed TCP connection before immediate same-port restart.
        self.start()
        for role, token in [('proposer', created['token']), ('opponent', guest['token'])]:
            status, _, raw = self.json_request('GET', endpoint, token=token)
            self.assertEqual(status, 200)
            actual = json.loads(raw)
            self.assertEqual(actual['myRole'], role)
            self.assertEqual(actual['events'], challenge['events'])
            self.assertEqual(actual['evidence'], challenge['evidence'])
        self.assertEqual(self.request(path=image_path,
            fields=['Authorization: Bearer '+guest['token']])[2], jpeg)
        self.assertEqual(self.json_request('POST', endpoint+'/join',
            {'inviteToken': created['inviteToken'], 'name': 'No replay'})[0], 404)

    def test_image_authority_and_framing_reject_before_body_or_audit_change(self):
        from https_oracle_fixtures import original_jpeg, image_frame
        self.start()
        created, guest, endpoint = self.active()
        before = self.json_request('GET', endpoint, token=created['token'])[2]
        common = ['Origin: '+self.origin, 'Content-Type: application/octet-stream']
        for fields, status in [([*common, 'Content-Length: 540688'], 401),
                ([*common, 'Content-Length: 540689', 'Authorization: Bearer '+guest['token']], 413)]:
            self.assertEqual(self.request('POST', endpoint+'/evidence/image', fields)[0], status)
        good = image_frame({'revision': 3, 'text': 'Exact original caption', 'url': None}, original_jpeg())
        for damaged in [good[:-1], good+b'x', b'BADMAGIC'+good[8:]]:
            fields = [*common, 'Authorization: Bearer '+guest['token'],
                      f'Content-Length: {len(damaged)}']
            self.assertEqual(self.request('POST', endpoint+'/evidence/image', fields, damaged)[0], 400)
        self.assertEqual(self.json_request('GET', endpoint, token=created['token'])[2], before)

    def test_prefetched_creation_body_excluded_and_pipelined_second_mutation_ignored(self):
        from https_oracle_fixtures import original_terms
        self.start()
        body = json.dumps({'name': 'Original proposer', 'terms': original_terms()}).encode()
        request = wire_request(self.authority, 'POST', '/api/challenges', [
            'Origin: '+self.origin, 'X-Friendly-Setup-Key: '+self.secret,
            'Content-Type: application/json', f'Content-Length: {len(body)}'], body)
        boundary = request.index(b'\r\n\r\n')
        exact = request[:boundary]+b'\r\nX-Pad: '+b'x'*(16384-boundary-4-len(b'X-Pad: \r\n'))+request[boundary:]
        self.assertEqual(exact.index(b'\r\n\r\n')+4, 16384)
        with self.connect() as client:
            client.sendall(exact+request)
            raw = receive(client)
        self.assertEqual(split_response(raw)[0], 201)
        self.assertEqual(raw.count(b'HTTP/1.1 '), 1)
        import sqlite3
        connection = sqlite3.connect(self.case/'library/challenges.sqlite3')
        try:
            self.assertEqual(connection.execute('SELECT count(*) FROM challenges').fetchone()[0], 1)
        finally:
            connection.close()

    def test_occupied_bind_preserves_original_raw_sqlite_and_audit(self):
        from https_oracle_fixtures import original_terms
        old = create_server(self.case/'library', 0, dist_dir=self.dist, now=lambda: 1900000000.0)
        try:
            old.store.create({'name': 'Original proposer', 'terms': original_terms()})
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

    def test_scaled_held_store_lock_refuses_teardown_until_request_exits(self):
        from unittest.mock import patch
        server = self.start()
        created = self.creation()
        entered, release = threading.Event(), threading.Event()
        original = server.store.get
        def held_get(*args, **kwargs):
            with server.store._lock:
                entered.set()
                if not release.wait(8):
                    raise RuntimeError('Controlled original Store lock fixture timed out')
                return original(*args, **kwargs)
        client = self.connect()
        self.addCleanup(client.close)
        self.addCleanup(release.set)
        with patch.object(server.store, 'get', held_get), patch.object(transport, 'REQUEST_JOIN_SECONDS', .15):
            client.sendall(wire_request(self.authority, path='/api/challenges/'+created['challengeId'],
                                       fields=['Authorization: Bearer '+created['token']]))
            self.assertTrue(entered.wait(3))
            server.shutdown()
            start = time.monotonic()
            try:
                with self.assertRaises(RuntimeError):
                    server.server_close()
                self.assertLess(time.monotonic()-start, 1.5)
                with self.assertRaises((RuntimeError, OSError)):
                    create_server(self.case/'library', 0, dist_dir=self.dist)
            finally:
                release.set()
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

    def test_eight_mib_static_response_exact_bytes_and_scaled_backpressure(self):
        """Native static response budget; image semantics have a separate real JPEG oracle."""
        from unittest.mock import patch
        assets = self.dist/'assets'
        assets.mkdir()
        payload = b'/*'+b'x'*(8*1024*1024-4)+b'*/'
        (assets/'oracle-original.js').write_bytes(payload)
        self.start()
        status, headers, actual = self.request(path='/assets/oracle-original.js')
        self.assertEqual((status, len(actual)), (200, 8388608))
        self.assertEqual(hashlib.sha256(actual).digest(), hashlib.sha256(payload).digest())
        self.assertIn(b'content-length: 8388608', [h.lower() for h in headers])
        raw = socket.socket()
        raw.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024)
        raw.settimeout(3)
        raw.connect(('127.0.0.1', self.port))
        client = trusted_context(self.certs).wrap_socket(raw, server_hostname='127.0.0.1')
        self.addCleanup(client.close)
        with patch.object(transport, 'RESPONSE_SECONDS', .2):
            client.sendall(wire_request(self.authority, path='/assets/oracle-original.js'))
            header = b''
            while not header.endswith(b'\r\n\r\n'):
                part = client.recv(1)
                self.assertTrue(part, 'Connection ended before original static headers')
                header += part
                self.assertLess(len(header), 16384)
            self.assertEqual(split_response(header)[0], 200)
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
