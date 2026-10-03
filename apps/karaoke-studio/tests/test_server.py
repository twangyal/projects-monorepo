"""Real loopback HTTP tests; injected workers are confined to this suite."""

from __future__ import annotations

import http.client
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import wave
import socket
import selectors
import signal
import subprocess
import sys
from unittest.mock import patch

from karaoke import server as server_module

from karaoke.server import create_server


def fake_separate(source, output_dir, model_root, cancel, stage):
    stage("Separating test audio")
    output_dir.mkdir(parents=True, exist_ok=True)
    for name in ("source.wav", "vocals.wav", "backing.wav"):
        with wave.open(str(output_dir / name), "wb") as audio:
            audio.setparams((2, 2, 44100, 0, "NONE", "not compressed"))
            audio.writeframes(b"\0" * (44100 * 2 * 4))
    return 2.0


def fake_export(project, backing, output, work_dir, font_path, cancel):
    output.write_bytes(b"test-only MP4")


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dist = self.root / "dist"
        self.dist.mkdir()
        (self.dist / "index.html").write_text("<h1>Karaoke test</h1>")
        self.server = self.start_server()
        status, _, payload = self.request("GET", "/api/session")
        self.assertEqual(status, 200)
        self.token = payload["token"]

    def start_server(self, **kwargs):
        server = create_server(
            self.root / "data", self.root / "model", port=0, dist_dir=self.dist,
            separate=kwargs.pop("separate", fake_separate),
            export=kwargs.pop("export", fake_export),
            ready=kwargs.pop("ready", lambda _: True), **kwargs,
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def stop():
            server.shutdown()
            server.server_close()
            thread.join(3)

        self.addCleanup(stop)
        return server

    def request(self, method, path, body=None, headers=None, server=None):
        server = server or self.server
        connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
        request_headers = dict(headers or {})
        if method in {"POST", "PUT", "DELETE"} and hasattr(self, "token"):
            request_headers.setdefault("X-Karaoke-Token", self.token)
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            request_headers.setdefault("Content-Type", "application/json")
        connection.request(method, path, body=body, headers=request_headers)
        response = connection.getresponse()
        data = response.read()
        result_headers = dict(response.getheaders())
        connection.close()
        if result_headers.get("Content-Type", "").startswith("application/json"):
            data = json.loads(data)
        return response.status, result_headers, data

    def upload(self):
        status, _, payload = self.request(
            "POST", "/api/projects", b"fake-audio", {"X-Audio-Name": "song%20clip.wav"},
        )
        self.assertEqual(status, 202, payload)
        return self.wait_job(payload["job"]["id"])

    def wait_job(self, job_id):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            status, _, payload = self.request("GET", f"/api/jobs/{job_id}")
            self.assertEqual(status, 200)
            if payload["job"]["status"] != "running":
                return payload["job"]
            time.sleep(.01)
        self.fail("Worker did not finish promptly")

    def test_session_and_static_files_are_local_and_bounded(self):
        status, headers, session = self.request("GET", "/api/session")
        self.assertEqual(session["maxDuration"], 30)
        self.assertEqual(session["maxProjects"], 20)
        self.assertTrue(session["modelReady"])
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(self.request("GET", "/")[2], b"<h1>Karaoke test</h1>")
        for path in ("/../../etc/passwd", "/assets/%2e%2e/server.py", "/api/projects/nope"):
            self.assertNotEqual(self.request("GET", path)[0], 200)

    def test_host_origin_and_write_token_are_enforced(self):
        self.assertEqual(self.request("GET", "/api/session", headers={"Host": "evil.test"})[0], 403)
        self.assertEqual(self.request("GET", "/api/session", headers={"Origin": "https://evil.test"})[0], 403)
        self.assertEqual(self.request("GET", "/api/session", headers={"Sec-Fetch-Site": "cross-site"})[0], 403)
        for token in ("", "wrong-token"):
            self.assertEqual(self.request("POST", "/api/projects", b"audio",
                                          {"X-Karaoke-Token": token})[0], 403)

    def test_upload_publishes_project_and_fixed_audio_files(self):
        job = self.upload()
        self.assertEqual(job["status"], "complete", job)
        project_id = job["projectId"]
        self.assertRegex(project_id, r"^[0-9a-f]{32}$")
        status, _, project = self.request("GET", f"/api/projects/{project_id}")
        self.assertEqual(status, 200)
        self.assertEqual(project["title"], "song clip")
        self.assertEqual(project["revision"], 0)
        self.assertEqual(self.request("GET", "/api/projects")[2]["projects"], [project])
        for stem in ("original", "vocals", "backing"):
            status, headers, data = self.request("GET", f"/api/projects/{project_id}/audio/{stem}")
            self.assertEqual(status, 200)
            self.assertEqual(headers["Content-Type"], "audio/wav")
            self.assertEqual(int(headers["Content-Length"]), len(data))
            self.assertTrue(data.startswith(b"RIFF"))
        self.assertEqual(self.request("GET", f"/api/projects/{project_id}/audio/../project.json")[0], 404)

    def test_completed_project_retains_bounded_processing_provenance(self):
        metadata = {"stemGain": .98, "checkpointSHA256": "test-checksum", "offline": True}

        def separate_with_metadata(*args):
            duration = fake_separate(*args)
            (args[1] / "processing.json").write_text(json.dumps(metadata), encoding="utf-8")
            return duration

        self.server.separate = separate_with_metadata
        job = self.upload()
        self.assertEqual(job["status"], "complete")
        path = self.server.projects_dir / job["projectId"] / "processing.json"
        self.assertTrue(path.is_file(), "Processing provenance was discarded with temporary work")
        self.assertEqual(json.loads(path.read_text("utf-8")), metadata)
        self.assertEqual(self.request("GET", f'/api/projects/{job["projectId"]}/processing.json')[0], 404)

    def test_atomic_save_stale_revisions_lyrics_and_export_invalidation(self):
        project_id = self.upload()["projectId"]
        endpoint = f"/api/projects/{project_id}"
        initial = self.request("GET", endpoint)[2]
        self.assertEqual(self.request("POST", endpoint + "/export", {})[0], 400)
        changes = {"title": "A café song", "revision": 0,
                   "cues": [{"start": 0.0, "end": 1.0, "text": "<script>literal</script>"}]}
        status, _, updated = self.request("PUT", endpoint, changes)
        self.assertEqual(status, 200, updated)
        self.assertEqual(updated["revision"], 1)
        self.assertEqual(self.request("PUT", endpoint, changes)[0], 409)
        self.assertEqual(self.request("GET", endpoint)[2], updated)
        status, headers, srt = self.request("GET", endpoint + "/lyrics")
        self.assertEqual(status, 200)
        self.assertIn("attachment", headers["Content-Disposition"])
        self.assertIn(b"&lt;script&gt;literal&lt;/script&gt;", srt)
        status, _, response = self.request("POST", endpoint + "/export", {})
        self.assertEqual(status, 202)
        job = self.wait_job(response["job"]["id"])
        self.assertEqual(job["status"], "complete", job)
        self.assertEqual(job["resultUrl"], endpoint + "/video")
        status, headers, mp4 = self.request("GET", endpoint + "/video")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "video/mp4")
        self.assertIn("attachment", headers["Content-Disposition"])
        self.assertEqual(mp4, b"test-only MP4")
        changes["revision"] = 1
        changes["title"] = "New title"
        self.assertEqual(self.request("PUT", endpoint, changes)[0], 200)
        self.assertEqual(self.request("GET", endpoint + "/video")[0], 409)
        self.assertEqual(initial["revision"], 0)

    def test_audio_ranges_enable_seeking_with_bounded_get_and_head_responses(self):
        project_id = self.upload()["projectId"]
        endpoint = f"/api/projects/{project_id}/audio/original"
        full = self.request("GET", endpoint)[2]
        length = len(full)
        cases = [("bytes=0-3", 0, 3), ("bytes=44-", 44, length - 1),
                 ("bytes=-8", length - 8, length - 1),
                 ("bytes=1-99999999999999999999", 1, length - 1)]
        for value, start, end in cases:
            with self.subTest(range=value):
                status, headers, body = self.request("GET", endpoint, headers={"Range": value})
                self.assertEqual(status, 206)
                self.assertEqual(headers["Accept-Ranges"], "bytes")
                self.assertEqual(headers["Content-Range"], f"bytes {start}-{end}/{length}")
                self.assertEqual(int(headers["Content-Length"]), end - start + 1)
                self.assertEqual(body, full[start:end + 1])
        status, headers, body = self.request("HEAD", endpoint, headers={"Range": "bytes=0-3"})
        self.assertEqual(status, 206)
        self.assertEqual(headers["Content-Length"], "4")
        self.assertEqual(body, b"")
        for value in (f"bytes={length}-", "bytes=4-2", "bytes=-0", "bytes=0-1,3-4",
                      "bytes=-", "items=0-1", "bytes=" + "9" * 2000 + "-"):
            with self.subTest(range=value):
                status, headers, body = self.request("GET", endpoint, headers={"Range": value})
                self.assertEqual(status, 416)
                self.assertEqual(headers["Content-Range"], f"bytes */{length}")
                self.assertEqual(body, b"")

    def test_missing_model_and_body_limits_reject_without_jobs(self):
        self.server.ready = lambda _: False
        self.assertEqual(self.request("POST", "/api/projects", b"audio")[0], 503)
        self.server.ready = lambda _: True
        self.assertEqual(self.request("POST", "/api/projects", b"",
                                      {"Content-Length": str(20 * 1024 * 1024 + 1)})[0], 413)
        self.assertEqual(self.request("POST", "/api/projects", b"",
                                      {"Transfer-Encoding": "chunked"})[0], 400)
        self.assertEqual(self.request("POST", "/api/projects", b"")[0], 400)
        self.assertEqual(self.request("GET", "/api/projects")[2], {"projects": []})

    def test_invalid_json_and_metadata_do_not_replace_project(self):
        project_id = self.upload()["projectId"]
        endpoint = f"/api/projects/{project_id}"
        baseline = self.request("GET", endpoint)[2]
        for body in (b"{", b"\xff", b"null", b'{"revision":NaN}',
                     b'{"title":"one","title":"two"}'):
            self.assertEqual(self.request("PUT", endpoint, body,
                                          {"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.request("PUT", endpoint, b"",
                                      {"Content-Length": "65537"})[0], 413)
        bad = {"title": "Bad", "revision": 0,
               "cues": [{"start": 1, "end": 3, "text": "too long"}]}
        self.assertEqual(self.request("PUT", endpoint, bad)[0], 400)
        self.assertEqual(self.request("GET", endpoint)[2], baseline)

    def test_active_job_can_be_cancelled_without_publishing_incomplete_project(self):
        started = threading.Event()

        def slow_separate(source, output_dir, model_root, cancel, stage):
            started.set()
            if not cancel.wait(3):
                raise RuntimeError("test worker timed out")
            raise RuntimeError("cancelled test worker")

        self.server.separate = slow_separate
        status, _, payload = self.request("POST", "/api/projects", b"audio")
        self.assertEqual(status, 202)
        self.assertTrue(started.wait(1))
        session = self.request("GET", "/api/session")[2]
        self.assertEqual(session["activeJob"]["id"], payload["job"]["id"])
        self.assertEqual(self.request("POST", "/api/projects", b"audio")[0], 409)
        job_id = payload["job"]["id"]
        self.assertEqual(self.request("POST", f"/api/jobs/{job_id}/cancel", {})[0], 200)
        self.assertEqual(self.wait_job(job_id)["status"], "cancelled")
        self.assertEqual(self.request("GET", "/api/projects")[2]["projects"], [])
        deadline = time.monotonic() + 1
        while list((self.root / "data" / ".jobs").iterdir()) and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertEqual(list((self.root / "data" / ".jobs").iterdir()), [])
        self.assertIsNone(self.request("GET", "/api/session")[2]["activeJob"])

    def test_project_quota_preserves_existing_projects(self):
        project_ids = [self.upload()["projectId"] for _ in range(20)]
        self.assertEqual(self.request("POST", "/api/projects", b"audio")[0], 409)
        listed = self.request("GET", "/api/projects")[2]["projects"]
        self.assertEqual({project["id"] for project in listed}, set(project_ids))
        self.assertEqual(self.request("DELETE", f"/api/projects/{project_ids[0]}", {})[0], 200)
        new_id = self.upload()["projectId"]
        listed = self.request("GET", "/api/projects")[2]["projects"]
        self.assertEqual({project["id"] for project in listed}, set(project_ids[1:]) | {new_id})

    def test_delete_requires_token_and_preserves_unrelated_projects(self):
        first = self.upload()["projectId"]
        second = self.upload()["projectId"]
        endpoint = f"/api/projects/{first}"
        self.assertEqual(self.request("DELETE", endpoint, {}, {"X-Karaoke-Token": ""})[0], 403)
        self.assertEqual(self.request("GET", endpoint)[0], 200)
        status, _, result = self.request("DELETE", endpoint, {})
        self.assertEqual(status, 200)
        self.assertEqual(result, {"deleted": True, "projectId": first})
        self.assertEqual(self.request("GET", endpoint)[0], 404)
        self.assertEqual(self.request("DELETE", endpoint, {})[0], 404)
        self.assertEqual(self.request("GET", f"/api/projects/{second}")[0], 200)
        self.assertEqual(self.request("GET", f"/api/projects/{second}/audio/backing")[0], 200)
        self.assertEqual(list(self.server.trash_dir.iterdir()), [])

    def test_failed_delete_staging_preserves_completed_project(self):
        project_id = self.upload()["projectId"]
        endpoint = f"/api/projects/{project_id}"
        baseline = self.request("GET", endpoint)[2]
        original = server_module.os.replace

        def fail_stage(source, target):
            if Path(source) == self.server.projects_dir / project_id:
                raise OSError("test rename failure")
            return original(source, target)

        with patch("karaoke.server.os.replace", side_effect=fail_stage):
            self.assertEqual(self.request("DELETE", endpoint, {})[0], 500)
        self.assertEqual(self.request("GET", endpoint)[2], baseline)
        self.assertEqual(self.request("GET", endpoint + "/audio/original")[0], 200)

    def test_data_dir_lock_precedes_cleanup_and_failed_bind_releases_resources(self):
        live = self.server.work_dir / ("a" * 32)
        live.mkdir()
        (live / "input.audio").write_bytes(b"live media")

        def construct(data, port=0):
            return create_server(data, self.root / "model", port=port, dist_dir=self.dist,
                                 separate=fake_separate, export=fake_export, ready=lambda _: True)

        for port in (0, self.server.server_port):
            with self.subTest(port=port), self.assertRaisesRegex(RuntimeError, "already in use"):
                duplicate = construct(self.server.data_dir, port)
                duplicate.server_close()
            self.assertEqual((live / "input.audio").read_bytes(), b"live media")
        other_data = self.root / "other-data"
        with self.assertRaises(OSError):
            construct(other_data, self.server.server_port)
        independent = construct(other_data)
        independent.server_close()
        self.server.shutdown()
        self.server.server_close()
        reopened = construct(self.server.data_dir)
        reopened.server_close()
        self.assertFalse(live.exists())

    def test_missing_length_and_slow_json_do_not_block_other_requests(self):
        project_id = self.upload()["projectId"]
        port = self.server.server_port
        with socket.create_connection(("127.0.0.1", port), timeout=2) as connection:
            request = (f"POST /api/projects HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
                       f"X-Karaoke-Token: {self.token}\r\n\r\n")
            connection.sendall(request.encode())
            self.assertIn(b" 411 ", connection.recv(4096))
        with socket.create_connection(("127.0.0.1", port), timeout=2) as connection:
            request = (f"PUT /api/projects/{project_id} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
                       f"X-Karaoke-Token: {self.token}\r\nContent-Type: application/json\r\n"
                       "Content-Length: 100\r\n\r\n{")
            connection.sendall(request.encode())
            time.sleep(.05)
            began = time.monotonic()
            self.assertEqual(self.request("GET", "/api/projects")[0], 200)
            self.assertLess(time.monotonic() - began, 1)

    def test_editing_during_export_is_refused_and_cancellation_preserves_project(self):
        project_id = self.upload()["projectId"]
        endpoint = f"/api/projects/{project_id}"
        changes = {"title": "Saved", "revision": 0,
                   "cues": [{"start": 0, "end": 1, "text": "lyrics"}]}
        saved = self.request("PUT", endpoint, changes)[2]
        started = threading.Event()

        def slow_export(project, backing, output, work_dir, font_path, cancel):
            started.set()
            cancel.wait(3)
            output.write_bytes(b"cancelled export must not publish")

        self.server.export = slow_export
        status, _, response = self.request("POST", endpoint + "/export", {})
        self.assertEqual(status, 202)
        self.assertTrue(started.wait(1))
        changes["revision"] = 1
        self.assertEqual(self.request("PUT", endpoint, changes)[0], 409)
        self.assertEqual(self.request("DELETE", endpoint, {})[0], 409)
        self.request("POST", f'/api/jobs/{response["job"]["id"]}/cancel', {})
        self.assertEqual(self.wait_job(response["job"]["id"])["status"], "cancelled")
        self.assertEqual(self.request("GET", endpoint)[2], saved)
        self.assertEqual(self.request("GET", endpoint + "/video")[0], 404)

    def test_failed_job_is_visible_and_next_job_can_run(self):
        def fail(*args):
            raise ValueError("Unsupported test clip")

        self.server.separate = fail
        job = self.upload()
        self.assertEqual(job["status"], "failed")
        self.assertIn("Unsupported", job["error"])
        self.assertEqual(self.request("GET", "/api/projects")[2]["projects"], [])
        self.server.separate = fake_separate
        self.assertEqual(self.upload()["status"], "complete")

    def test_failed_export_publication_preserves_previous_download(self):
        project_id = self.upload()["projectId"]
        endpoint = f"/api/projects/{project_id}"
        self.request("PUT", endpoint, {"title": "Saved", "revision": 0,
                                       "cues": [{"start": 0, "end": 1, "text": "lyrics"}]})
        response = self.request("POST", endpoint + "/export", {})[2]
        self.assertEqual(self.wait_job(response["job"]["id"])["status"], "complete")
        before = self.request("GET", endpoint + "/video")[2]

        def replacement(project, backing, output, work_dir, font_path, cancel):
            output.write_bytes(b"unpublished replacement")

        atomic_json = server_module._atomic_json

        def fail_marker(path, value):
            if path.name == "video-revision.json":
                raise OSError("test storage failure")
            atomic_json(path, value)

        self.server.export = replacement
        with patch("karaoke.server._atomic_json", side_effect=fail_marker):
            response = self.request("POST", endpoint + "/export", {})[2]
            self.assertEqual(self.wait_job(response["job"]["id"])["status"], "failed")
        self.assertEqual(self.request("GET", endpoint + "/video")[2], before)

    def test_shutdown_cancels_worker_and_completed_projects_reopen(self):
        project_id = self.upload()["projectId"]
        complete = self.request("GET", f"/api/projects/{project_id}")[2]
        started = threading.Event()
        cancelled = threading.Event()

        def slow(*args):
            cancel = args[3]
            started.set()
            cancel.wait(3)
            cancelled.set()
            raise RuntimeError("shutdown cancellation")

        self.server.separate = slow
        self.request("POST", "/api/projects", b"audio")
        self.assertTrue(started.wait(1))
        self.server.server_close()
        self.assertTrue(cancelled.wait(1))
        reopened = self.start_server()
        status, _, project = self.request("GET", f"/api/projects/{project_id}", server=reopened)
        self.assertEqual(status, 200)
        self.assertEqual(project, complete)

    def test_job_history_is_bounded_without_deleting_completed_projects(self):
        self.server.jobs.max_records = 3
        jobs = [self.upload() for _ in range(4)]
        self.assertEqual(self.request("GET", f'/api/jobs/{jobs[0]["id"]}')[0], 404)
        self.assertEqual(self.request("GET", f'/api/jobs/{jobs[-1]["id"]}')[0], 200)
        self.assertEqual(len(self.request("GET", "/api/projects")[2]["projects"]), 4)

    @unittest.skipUnless(sys.platform != "win32", "POSIX termination signal")
    def test_production_cli_starts_without_model_download_and_exits_cleanly_on_sigterm(self):
        command = [sys.executable, "-m", "karaoke", "--data-dir", str(self.root / "cli-data"),
                   "--model-dir", str(self.root / "missing-model"), "--port", "0"]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                self.assertTrue(selector.select(3), "CLI did not announce its local URL")
            line = process.stdout.readline().decode()
            self.assertIn("http://127.0.0.1:", line)
            port = int(line.strip().rsplit(":", 1)[-1])
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
            try:
                connection.request("GET", "/api/session")
                response = connection.getresponse()
                session = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertFalse(session["modelReady"])
            finally:
                connection.close()
            process.send_signal(signal.SIGTERM)
            self.assertEqual(process.wait(timeout=3), 0)
            self.assertFalse((self.root / "missing-model").exists())
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=3)
            process.stdout.close()
            process.stderr.close()


if __name__ == "__main__":
    unittest.main()
