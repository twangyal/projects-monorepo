"""HTTP acceptance uses the real Store and loopback sockets, not a fake backend."""

import http.client
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from challenges.server import create_server


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dist = self.root / "dist"
        (self.dist / "assets").mkdir(parents=True)
        (self.dist / "index.html").write_text("<h1>Friendly Challenges</h1>")
        (self.dist / "assets/app-test.js").write_text('console.log("local")')
        self.now = 1900000000.0
        self.server = self.start_server()
        self.terms = dict(
            title="A friendly race",
            description="Run the route",
            successCriteria="Proposer finishes first",
            evidenceRule="Record the finish time",
            stake="bragging-rights",
            deadline=int(self.now * 1000) + 60000,
        )
        status, _, created = self.request(
            "POST", "/api/challenges", {"name": "Alex", "terms": self.terms}
        )
        self.assertEqual(status, 201, created)
        self.created = created
        self.endpoint = "/api/challenges/" + created["challengeId"]
        self.host = created["token"]

    def start_server(self, data=None, **options):
        server = create_server(
            data or self.root / "data", 0, dist_dir=self.dist, now=lambda: self.now, **options
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def stop():
            server.shutdown()
            server.server_close()
            thread.join(3)

        self.addCleanup(stop)
        return server

    def request(self, method, path, body=None, token=None, headers=None, server=None):
        target = server or self.server
        connection = http.client.HTTPConnection("127.0.0.1", target.server_port, timeout=3)
        values = dict(headers or {})
        if token is not None:
            values["Authorization"] = "Bearer " + token
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            values.setdefault("Content-Type", "application/json")
        try:
            connection.request(method, path, body=body, headers=values)
            response = connection.getresponse()
            contents = response.read()
            metadata = dict(response.getheaders())
            if contents and metadata.get("Content-Type", "").startswith("application/json"):
                contents = json.loads(contents)
            return response.status, metadata, contents
        finally:
            connection.close()

    def raw(self, request):
        connection = socket.create_connection(("127.0.0.1", self.server.server_port), timeout=3)
        try:
            connection.sendall(request.encode())
            response = http.client.HTTPResponse(connection)
            response.begin()
            content = response.read()
            return response.status, content
        finally:
            connection.close()

    def snapshot(self, token=None):
        status, _, result = self.request("GET", self.endpoint, token=token or self.host)
        self.assertEqual(status, 200, result)
        return result

    def command(self, action, token=None, **body):
        body.setdefault("revision", self.snapshot()["revision"])
        return self.request("POST", self.endpoint + "/" + action, body, token or self.host)

    def accept(self):
        status, _, claim = self.request(
            "POST",
            self.endpoint + "/join",
            {"inviteToken": self.created["inviteToken"], "name": "Blair"},
        )
        self.assertEqual(status, 200, claim)
        self.guest = claim["token"]
        response = self.command(
            "accept", self.guest, termsVersion=claim["challenge"]["termsVersion"]
        )
        self.assertEqual(response[0], 200, response)
        return response[2]

    def test_private_capabilities_and_status_do_not_leak_a_directory_or_cookie_access(self):
        status, headers, public = self.request("GET", "/api/status")
        self.assertEqual((status, public), (200, {"schemaVersion": 1, "maxChallenges": 20}))
        self.assertNotIn("Set-Cookie", headers)
        for token in (None, "bad", "a" * 64, self.created["inviteToken"]):
            response = self.request("GET", self.endpoint, token=token)
            self.assertEqual(response[0], 401)
        self.assertEqual(
            self.request("GET", self.endpoint, headers={"Cookie": "seat=" + self.host})[0], 401
        )
        self.assertEqual(self.request("GET", "/api/challenges")[0], 404)
        snapshot = self.snapshot()
        self.assertNotIn(self.host, json.dumps(snapshot))
        self.assertNotIn(self.created["inviteToken"], json.dumps(snapshot))
        self.assertEqual(snapshot["myRole"], "proposer")

    def test_exact_host_origin_fetch_metadata_and_duplicate_headers(self):
        good = f"127.0.0.1:{self.server.server_port}"
        for headers in (
            {"Host": "evil.example"},
            {"Origin": "https://evil.example"},
            {"Origin": "null"},
            {"Sec-Fetch-Site": "cross-site"},
            {"Host": good, "Origin": f"http://localhost:{self.server.server_port}"},
        ):
            self.assertEqual(self.request("GET", "/api/status", headers=headers)[0], 403)
        self.assertEqual(
            self.request("GET", "/api/status", headers={"Origin": "http://" + good})[0], 200
        )
        for duplicates in (
            f"Host: {good}\r\nHost: {good}",
            f"Host: {good}\r\nOrigin: http://{good}\r\nOrigin: http://{good}",
        ):
            self.assertEqual(
                self.raw("GET /api/status HTTP/1.1\r\n" + duplicates + "\r\n\r\n")[0], 403
            )
        status, body = self.raw(
            f"GET {self.endpoint} HTTP/1.1\r\nHost: {good}\r\nAuthorization: Bearer {self.host}\r\nAuthorization: Bearer {self.host}\r\n\r\n"
        )
        self.assertEqual(status, 400)
        self.assertNotIn(self.host.encode(), body)

    def test_non_body_routes_still_reject_invalid_framing_headers(self):
        good = f"127.0.0.1:{self.server.server_port}"
        for framing in [
            "Content-Length: 0\r\nContent-Length: 0",
            "Content-Length: nope",
            "Content-Length: 2",
            "Transfer-Encoding: chunked",
        ]:
            status, _ = self.raw(f"GET /api/status HTTP/1.1\r\nHost: {good}\r\n{framing}\r\n\r\n")
            self.assertEqual(status, 400)

    def test_static_challenge_links_headers_and_traversal(self):
        for path in ["/", "/?challenge=" + self.created["challengeId"]]:
            status, headers, body = self.request("GET", path)
            self.assertEqual(status, 200)
            self.assertIn(b"Friendly Challenges", body)
            self.assertEqual(headers["Cache-Control"], "no-store")
            self.assertEqual(headers["Referrer-Policy"], "no-referrer")
            self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertEqual(self.request("HEAD", "/")[2], b"")
        self.assertEqual(self.request("GET", "/assets/app-test.js")[0], 200)
        for path in [
            "/?token=" + self.host,
            "/?challenge=x",
            "/?challenge=" + self.created["challengeId"] + "&x=1",
            self.endpoint + "?token=" + self.host,
        ]:
            response = self.request("GET", path, token=self.host)
            self.assertEqual(response[0], 400)
            self.assertNotIn(self.host, json.dumps(response[2]))
        for path in [
            "/../secret",
            "/assets/../../secret",
            "/%2e%2e/secret",
            "/assets/app-test.js.map",
            "/unknown",
        ]:
            self.assertEqual(self.request("GET", path)[0], 404)
        secret = self.root / "secret.js"
        secret.write_text("PRIVATE_SENTINEL")
        (self.dist / "assets/secret.js").symlink_to(secret)
        response = self.request("GET", "/assets/secret.js")
        self.assertEqual(response[0], 404)
        self.assertNotIn("PRIVATE_SENTINEL", json.dumps(response[2]))

    def test_json_encoding_shape_duplicate_keys_depth_and_body_limits_are_atomic(self):
        before = self.snapshot()
        for body in [
            b"{",
            b"{} trailing",
            b"[]",
            b"\xff",
            b'{"revision":1,"revision":1}',
            b'{"revision":NaN}',
            b'{"revision":1e999}',
            b"[" * 1000 + b"]" * 1000,
        ]:
            status, _, response = self.request(
                "POST",
                self.endpoint + "/accept",
                body,
                self.host,
                {"Content-Type": "application/json"},
            )
            self.assertEqual(status, 400, response)
        self.assertEqual(self.request("POST", self.endpoint + "/accept", b"{}", self.host)[0], 400)
        self.assertEqual(
            self.request(
                "POST",
                "/api/challenges",
                b"x" * 16385,
                headers={"Content-Type": "application/json"},
            )[0],
            413,
        )
        self.assertEqual(self.snapshot(), before)
        good = f"127.0.0.1:{self.server.server_port}"
        for headers in [
            "Content-Length: 2\r\nContent-Length: 2",
            "Transfer-Encoding: chunked",
            "Content-Length: -1",
        ]:
            self.assertEqual(
                self.raw(
                    f"POST /api/challenges HTTP/1.1\r\nHost: {good}\r\nContent-Type: application/json\r\n{headers}\r\n\r\n{{}}"
                )[0],
                400,
            )
        status, _ = self.raw(
            f"POST /api/challenges HTTP/1.1\r\nHost: {good}\r\nExpect: 100-continue\r\nContent-Length: 2\r\n\r\n"
        )
        self.assertEqual(status, 417)

    def test_real_agreement_evidence_resolution_export_and_stale_write(self):
        initial = self.snapshot()
        self.accept()
        self.assertEqual(self.command("terms", terms=self.terms)[0], 409)
        stale = self.command(
            "evidence", self.guest, revision=initial["revision"], text="stale", url=None
        )
        self.assertEqual(stale[0], 409)
        self.now += 60
        status, _, posted = self.command(
            "evidence",
            self.guest,
            text="<script>literal evidence</script>",
            url="https://example.com/result",
        )
        self.assertEqual(status, 200)
        self.assertTrue(posted["evidence"][0]["late"])
        status, _, proposal = self.command("result", outcome="opponent", reason="Recorded finish")
        self.assertEqual(status, 200)
        proposal_id = proposal["resultProposal"]["id"]
        self.assertEqual(
            self.command("result/respond", proposalId=proposal_id, accept=True, reason="")[0], 403
        )
        final = self.command(
            "result/respond", self.guest, proposalId=proposal_id, accept=True, reason=""
        )
        self.assertEqual(final[0], 200)
        self.assertEqual(final[2]["status"], "resolved")
        self.assertEqual(self.command("evidence", text="after final", url=None)[0], 409)
        status, headers, exported = self.request("GET", self.endpoint + "/export", token=self.guest)
        self.assertEqual(status, 200)
        self.assertIn("attachment;", headers["Content-Disposition"])
        self.assertEqual(exported["challenge"]["resolution"]["outcome"], "opponent")
        for secret in [self.host, self.guest, self.created["inviteToken"], "myRole", "serverTime"]:
            self.assertNotIn(secret, json.dumps(exported))

    def test_cross_challenge_credentials_and_invitation_types_are_isolated(self):
        other = self.request("POST", "/api/challenges", {"name": "Other", "terms": self.terms})[2]
        self.assertEqual(self.request("GET", self.endpoint, token=other["token"])[0], 401)
        self.assertEqual(
            self.request(
                "POST",
                self.endpoint + "/arbiter/join",
                {"inviteToken": self.created["inviteToken"], "name": "Alex"},
            )[0],
            404,
        )
        self.assertEqual(
            self.request(
                "POST",
                self.endpoint + "/join",
                {"inviteToken": other["inviteToken"], "name": "Other"},
            )[0],
            404,
        )

    def test_lifetime_lock_prevents_second_service_and_reopen_preserves_agreement(self):
        self.accept()
        self.command("evidence", text="Durable record", url=None)
        before = self.snapshot()
        with self.assertRaisesRegex(RuntimeError, "in use|locked"):
            create_server(self.root / "data", 0, dist_dir=self.dist)
        self.server.shutdown()
        self.server.server_close()
        restarted = self.start_server()
        status, _, snapshot = self.request("GET", self.endpoint, token=self.guest, server=restarted)
        self.assertEqual(status, 200)
        self.assertEqual(snapshot["events"], before["events"])
        self.assertEqual(snapshot["status"], "active")
        self.assertEqual(snapshot["myRole"], "opponent")

    def test_data_lock_database_and_static_directory_symlinks_are_rejected(self):
        actual = self.root / "actual"
        actual.mkdir()
        linked = self.root / "linked"
        linked.symlink_to(actual, target_is_directory=True)
        with self.assertRaises((RuntimeError, OSError)):
            create_server(linked, 0, dist_dir=self.dist)
        for filename in [".server.lock", "challenges.sqlite3", "challenges.sqlite3-wal"]:
            data = self.root / filename.replace(".", "_")
            data.mkdir()
            (data / filename).symlink_to(self.root / "outside")
            with self.assertRaises((RuntimeError, OSError)):
                create_server(data, 0, dist_dir=self.dist)
        outside = self.root / "outside-assets"
        (self.dist / "assets").rename(outside)
        (self.dist / "assets").symlink_to(outside, target_is_directory=True)
        self.assertEqual(self.request("GET", "/assets/app-test.js")[0], 404)

    def test_generic_errors_and_unsupported_methods_never_reflect_secrets(self):
        with patch.object(
            self.server.store, "get", side_effect=RuntimeError("PRIVATE_" + self.host)
        ):
            status, _, body = self.request("GET", self.endpoint, token=self.host)
            self.assertEqual(status, 500)
            self.assertEqual(body["code"], "internal_error")
            self.assertNotIn(self.host, json.dumps(body))
        for method in ["PUT", "DELETE", "OPTIONS", "TRACE"]:
            self.assertEqual(self.request(method, self.endpoint, {}, self.host)[0], 405)
        self.assertEqual(self.request("HEAD", self.endpoint, token=self.host)[0], 405)

    def test_shutdown_interrupts_pending_body_before_releasing_directory_lock(self):
        connection = socket.create_connection(("127.0.0.1", self.server.server_port), timeout=2)
        self.addCleanup(connection.close)
        connection.sendall(
            (
                f"POST /api/challenges HTTP/1.1\r\nHost: 127.0.0.1:{self.server.server_port}\r\n"
                "Content-Type: application/json\r\nContent-Length: 100\r\n\r\n{"
            ).encode()
        )
        time.sleep(0.05)
        started = time.monotonic()
        self.server.shutdown()
        self.server.server_close()
        self.assertLess(time.monotonic() - started, 2)
        restarted = self.start_server()
        self.assertEqual(
            self.request("GET", self.endpoint, token=self.host, server=restarted)[0], 200
        )

    def test_header_and_request_target_bounds_return_small_json_errors(self):
        host = f"127.0.0.1:{self.server.server_port}"
        status, body = self.raw(
            "GET /api/status HTTP/1.1\r\nHost: " + host + "\r\nX-Large: " + "x" * 17000 + "\r\n\r\n"
        )
        self.assertEqual(status, 431)
        self.assertLess(len(body), 500)
        self.assertEqual(json.loads(body)["code"], "invalid_request")
        status, _, body = self.request("GET", "/" + "x" * 2100)
        self.assertEqual(status, 404)
        self.assertLess(len(json.dumps(body)), 500)

    def test_default_inactivity_timeout_releases_a_partial_body(self):
        connection = socket.create_connection(("127.0.0.1", self.server.server_port), timeout=7)
        try:
            connection.sendall(
                (
                    f"POST /api/challenges HTTP/1.1\r\nHost: 127.0.0.1:{self.server.server_port}\r\n"
                    "Content-Type: application/json\r\nContent-Length: 100\r\n\r\n{"
                ).encode()
            )
            started = time.monotonic()
            response = http.client.HTTPResponse(connection)
            response.begin()
            self.assertEqual(response.status, 408)
            self.assertEqual(json.loads(response.read())["code"], "timeout")
            self.assertGreater(time.monotonic() - started, 4)
            self.assertLess(time.monotonic() - started, 7)
        finally:
            connection.close()

    def _assert_slow_headers_release_all_slots(self, prefix):
        connections = []
        with patch("challenges.server.HEADER_TIMEOUT", 1.0, create=True):
            try:
                for _ in range(16):
                    connection = socket.create_connection(
                        ("127.0.0.1", self.server.server_port), timeout=2
                    )
                    connections.append(connection)
                    connection.sendall(prefix)
                # Actual service behavior proves all slots are held initially.
                self.assertEqual(self.request("GET", "/api/status")[0], 503)
                for _ in range(12):
                    for connection in connections:
                        try:
                            connection.sendall(b"x")
                        except OSError:
                            pass
                    time.sleep(0.12)
                # Bytes arrive well inside the 5-second inactivity timeout.
                # A total header deadline must nevertheless release capacity.
                self.assertEqual(self.request("GET", "/api/status")[0], 200)
                for connection in connections:
                    self.assertEqual(connection.recv(1024), b"")
                self.assertEqual(self.snapshot()["revision"], 1)
            finally:
                for connection in connections:
                    connection.close()

    def test_total_header_deadline_releases_capacity_during_slow_field(self):
        host = f"127.0.0.1:{self.server.server_port}"
        self._assert_slow_headers_release_all_slots(
            f"GET /api/status HTTP/1.1\r\nHost: {host}\r\nX-Slow: ".encode()
        )

    def test_total_header_deadline_also_bounds_slow_request_line(self):
        self._assert_slow_headers_release_all_slots(b"GET /api/status")

    def test_header_deadline_is_shared_across_complete_header_lines(self):
        with patch("challenges.server.HEADER_TIMEOUT", 0.2, create=True):
            connection = socket.create_connection(
                ("127.0.0.1", self.server.server_port), timeout=2
            )
            try:
                host = f"127.0.0.1:{self.server.server_port}"
                connection.sendall(f"GET /api/status HTTP/1.1\r\nHost: {host}\r\n".encode())
                for _ in range(8):
                    try:
                        connection.sendall(b"X-Progress: value\r\n")
                    except OSError:
                        break
                    time.sleep(0.04)
                self.assertEqual(connection.recv(1024), b"")
                self.assertEqual(self.request("GET", "/api/status")[0], 200)
            finally:
                connection.close()

    def test_finished_headers_leave_body_its_independent_deadline(self):
        payload = json.dumps({"name": "Casey", "terms": self.terms}).encode()
        with patch("challenges.server.HEADER_TIMEOUT", 0.1, create=True):
            connection = socket.create_connection(
                ("127.0.0.1", self.server.server_port), timeout=2
            )
            try:
                connection.sendall(
                    (f"POST /api/challenges HTTP/1.1\r\nHost: 127.0.0.1:{self.server.server_port}\r\n"
                     f"Content-Type: application/json\r\nContent-Length: {len(payload)}\r\n\r\n").encode()
                    + payload[:1]
                )
                time.sleep(0.25)
                connection.sendall(payload[1:])
                response = http.client.HTTPResponse(connection)
                response.begin()
                self.assertEqual(response.status, 201)
                self.assertEqual(json.loads(response.read())["challenge"]["terms"], self.terms)
            finally:
                connection.close()

    def test_body_total_deadline_applies_even_while_bytes_keep_arriving(self):
        with patch("challenges.server.BODY_TIMEOUT", 0.2):
            connection = socket.create_connection(("127.0.0.1", self.server.server_port), timeout=2)
            try:
                connection.sendall(
                    (
                        f"POST /api/challenges HTTP/1.1\r\nHost: 127.0.0.1:{self.server.server_port}\r\n"
                        "Content-Type: application/json\r\nContent-Length: 100\r\n\r\n"
                    ).encode()
                )
                for _ in range(8):
                    try:
                        connection.sendall(b" ")
                    except OSError:
                        break
                    time.sleep(0.04)
                response = http.client.HTTPResponse(connection)
                response.begin()
                self.assertEqual(response.status, 408)
                self.assertEqual(json.loads(response.read())["code"], "timeout")
            finally:
                connection.close()

    def test_admission_is_bounded_and_capacity_recovers(self):
        connections = []
        try:
            for _ in range(16):
                connection = socket.create_connection(
                    ("127.0.0.1", self.server.server_port), timeout=2
                )
                connections.append(connection)
                connection.sendall(
                    (
                        f"POST /api/challenges HTTP/1.1\r\nHost: 127.0.0.1:{self.server.server_port}\r\n"
                        "Content-Type: application/json\r\nContent-Length: 100\r\n\r\n{"
                    ).encode()
                )
            status, _, body = self.request("GET", "/api/status")
            self.assertEqual(status, 503)
            self.assertEqual(body["code"], "busy")
        finally:
            for connection in connections:
                connection.close()
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if self.request("GET", "/api/status")[0] == 200:
                break
            time.sleep(0.01)
        else:
            self.fail("Handler capacity did not recover")

    def test_cli_sigterm_releases_lock_and_process_restart_preserves_real_resolution(self):
        data = self.root / "cli"
        endpoint, host, guest, recorded = None, None, None, None
        for attempt in range(2):
            process = subprocess.Popen(
                [sys.executable, "-m", "challenges", "--data-dir", str(data), "--port", "0"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                line = process.stdout.readline()
                self.assertTrue(line.startswith("Friendly Challenges: http://127.0.0.1:"), line)
                target = SimpleNamespace(server_port=int(line.strip().rsplit(":", 1)[1]))
                if attempt == 0:
                    terms = {**self.terms, "deadline": int(time.time() * 1000) + 60000}
                    status, _, created = self.request(
                        "POST", "/api/challenges", {"name": "Alex", "terms": terms}, server=target
                    )
                    self.assertEqual(status, 201, created)
                    endpoint, host = "/api/challenges/" + created["challengeId"], created["token"]
                    status, _, joined = self.request(
                        "POST",
                        endpoint + "/join",
                        {"inviteToken": created["inviteToken"], "name": "Blair"},
                        server=target,
                    )
                    self.assertEqual(status, 200, joined)
                    guest, current = joined["token"], joined["challenge"]
                    commands = [
                        ("accept", guest, {"termsVersion": current["termsVersion"]}),
                        ("evidence", host, {"text": "Real process evidence", "url": None}),
                        ("result", host, {"outcome": "proposer", "reason": "Agreed finish"}),
                    ]
                    for action, token, fields in commands:
                        status, _, current = self.request(
                            "POST",
                            endpoint + "/" + action,
                            {"revision": current["revision"], **fields},
                            token,
                            server=target,
                        )
                        self.assertEqual(status, 200, current)
                    status, _, recorded = self.request(
                        "POST",
                        endpoint + "/result/respond",
                        {
                            "revision": current["revision"],
                            "proposalId": current["resultProposal"]["id"],
                            "accept": True,
                            "reason": "",
                        },
                        guest,
                        server=target,
                    )
                    self.assertEqual(status, 200, recorded)
                    self.assertEqual(recorded["status"], "resolved")
                else:
                    for token, role in [(host, "proposer"), (guest, "opponent")]:
                        status, _, restored = self.request(
                            "GET", endpoint, token=token, server=target
                        )
                        self.assertEqual(status, 200, restored)
                        self.assertEqual(restored["myRole"], role)
                        self.assertEqual(restored["events"], recorded["events"])
                        self.assertEqual(restored["evidence"], recorded["evidence"])
                        self.assertEqual(restored["resolution"], recorded["resolution"])
                process.terminate()
                _, stderr = process.communicate(timeout=3)
                self.assertEqual(process.returncode, 0, stderr)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()

    def test_real_arbiter_routes_require_both_consents_and_a_distinct_seat(self):
        self.accept()
        proposed = self.command("result", outcome="proposer", reason="I finished")[2]
        disputed = self.command(
            "result/respond",
            self.guest,
            proposalId=proposed["resultProposal"]["id"],
            accept=False,
            reason="Timing is disputed",
        )
        self.assertEqual(disputed[0], 200, disputed)
        nomination = self.command("arbiter/nominate", name="Casey", reason="We trust Casey")[2][
            "arbiterNomination"
        ]
        self.assertEqual(self.command("invite", seat="arbiter")[0], 409)
        self.assertEqual(
            self.command(
                "arbiter/respond", self.guest, nominationId=nomination["id"], accept=True, reason=""
            )[0],
            200,
        )
        invitation = self.command("invite", seat="arbiter")[2]
        status, _, claimed = self.request(
            "POST",
            self.endpoint + "/arbiter/join",
            {"inviteToken": invitation["inviteToken"], "name": "Casey"},
        )
        self.assertEqual(status, 200, claimed)
        arbiter = claimed["token"]
        self.assertNotIn(arbiter, [self.host, self.guest, invitation["inviteToken"]])
        self.assertEqual(
            self.command("evidence", arbiter, text="Not a participant", url=None)[0], 403
        )
        self.assertEqual(
            self.command("arbiter/decide", outcome="void", reason="Not authorized")[0], 403
        )
        final = self.command(
            "arbiter/decide", arbiter, outcome="opponent", reason="The recorded time supports Blair"
        )
        self.assertEqual(final[0], 200, final)
        self.assertEqual(final[2]["resolution"]["method"], "arbiter")
        self.assertEqual(
            self.command("arbiter/decide", arbiter, outcome="proposer", reason="A second ruling")[
                0
            ],
            409,
        )

    def test_close_waits_for_active_store_command_before_releasing_flock(self):
        entered, release, closed = threading.Event(), threading.Event(), threading.Event()
        original = self.server.store.command

        def slow(*args):
            entered.set()
            release.wait(3)
            return original(*args)

        errors = []

        def issue():
            try:
                self.command("terms", terms={**self.terms, "title": "A revised race"})
            except OSError:
                pass  # Closing a live response socket must not expose its Store.

        def close():
            try:
                self.server.server_close()
            except Exception as error:
                errors.append(error)
            finally:
                closed.set()

        with patch.object(self.server.store, "command", side_effect=slow):
            request = threading.Thread(target=issue)
            request.start()
            self.assertTrue(entered.wait(2))
            self.server.shutdown()
            closer = threading.Thread(target=close)
            closer.start()
            try:
                self.assertFalse(closed.wait(0.1))
                with self.assertRaisesRegex(RuntimeError, "in use|locked"):
                    create_server(self.root / "data", 0, dist_dir=self.dist)
            finally:
                release.set()
                closer.join(3)
                request.join(3)
        self.assertTrue(closed.is_set())
        self.assertEqual(errors, [])
        reopened = self.start_server()
        restored = self.request("GET", self.endpoint, token=self.host, server=reopened)[2]
        self.assertEqual(restored["terms"]["title"], "A revised race")


if __name__ == "__main__":
    unittest.main()
