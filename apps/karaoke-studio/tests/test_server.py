"""Real loopback HTTP tests; injected workers are confined to this suite."""

from __future__ import annotations

import http.client
import errno
from types import SimpleNamespace
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
        self.assertEqual(session["maxDuration"], 300)
        self.assertEqual(session["maxProjects"], 20)
        self.assertEqual(session["maxUploadBytes"], 64 * 1024**2)
        self.assertEqual(session["maxCues"], 200)
        self.assertEqual(session["maxLyricChars"], 20000)
        self.assertTrue(session["modelReady"])
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(self.request("GET", "/")[2], b"<h1>Karaoke test</h1>")
        for path in ("/../../etc/passwd", "/assets/%2e%2e/server.py", "/api/projects/nope"):
            self.assertNotEqual(self.request("GET", path)[0], 200)

    def test_maximum_escaped_unicode_document_saves_and_reopens(self):
        project_id = self.upload()['projectId']
        endpoint = f'/api/projects/{project_id}'
        changes = {'title': '🎵' * 100, 'revision': 0,
                   'cues': [dict(start=i / 100, end=(i + 1) / 100, text='🎵' * 100)
                            for i in range(200)]}
        encoded = json.dumps(changes, ensure_ascii=True).encode('ascii')
        self.assertGreater(len(encoded), 240000)
        self.assertLess(len(encoded), 256 * 1024)
        status, _, saved = self.request('PUT', endpoint, encoded, {'Content-Type': 'application/json'})
        self.assertEqual(status, 200, saved)
        self.assertEqual(len(saved['cues']), 200)
        self.server.shutdown()
        self.server.server_close()
        self.server = self.start_server()
        self.token = self.request('GET', '/api/session')[2]['token']
        self.assertEqual(self.request('GET', endpoint)[2], saved)

    def test_disk_admission_rejects_upload_and_export_preserving_saved_work(self):
        project_id = self.upload()['projectId']
        endpoint = f'/api/projects/{project_id}'
        self.request('PUT', endpoint, {'title': 'Saved', 'revision': 0,
                                      'cues': [dict(start=0, end=1, text='Line')]})
        status, _, response = self.request('POST', endpoint + '/export', {})
        self.assertEqual(status, 202)
        self.assertEqual(self.wait_job(response['job']['id'])['status'], 'complete')
        baseline = self.request('GET', endpoint)[2]
        owned_fd = self.server._directory_fds[self.server.work_dir]
        with patch.object(server_module.os, 'fstatvfs', return_value=SimpleNamespace(f_bavail=1, f_frsize=4096)) as check:
            self.assertEqual(self.request('POST', '/api/projects', b'fake')[0], 507)
            self.assertEqual(self.request('POST', endpoint + '/export', {})[0], 507)
            self.assertTrue(check.call_args_list)
            self.assertTrue(all(call.args == (owned_fd,) for call in check.call_args_list))
        self.assertEqual(self.request('GET', endpoint)[2], baseline)
        self.assertEqual(self.request('GET', endpoint + '/video')[2], b'test-only MP4')
        self.assertEqual(list(self.server.work_dir.iterdir()), [])
        self.assertFalse(self.server.uploading)
        self.assertFalse(self.server.jobs.busy())

    def test_absolute_upload_deadline_stops_continuous_trickle_and_releases_slot(self):
        stop = threading.Event()
        with patch.object(server_module, 'UPLOAD_TIMEOUT', .2):
            with socket.create_connection(('127.0.0.1', self.server.server_port), timeout=1) as connection:
                headers = (f'POST /api/projects HTTP/1.1\r\nHost: 127.0.0.1:{self.server.server_port}\r\n'
                           f'X-Karaoke-Token: {self.token}\r\nContent-Length: 10000\r\n\r\n')
                connection.sendall(headers.encode())
                def trickle():
                    while not stop.wait(.02):
                        try:
                            connection.sendall(b'x')
                        except OSError:
                            break
                sender = threading.Thread(target=trickle)
                sender.start()
                try:
                    response = http.client.HTTPResponse(connection)
                    response.begin()
                    self.assertEqual(response.status, 408)
                    self.assertIn(b'timed out', response.read())
                finally:
                    stop.set()
                    sender.join(1)
        self.assertFalse(self.server.uploading)
        self.assertEqual(list(self.server.work_dir.iterdir()), [])
        self.assertFalse(self.server.jobs.busy())
        self.assertEqual(self.upload()['status'], 'complete')

    def test_oversized_worker_wav_cannot_publish(self):
        def oversized(source, output, model, cancel, stage):
            duration = fake_separate(source, output, model, cancel, stage)
            with (output / 'source.wav').open('wb') as stream:
                stream.truncate(300 * 44100 * 4 + 4097)
            return duration
        self.server.separate = oversized
        job = self.upload()
        self.assertEqual(job['status'], 'failed', job)
        self.assertEqual(self.server.projects, {})
        self.assertEqual(list(self.server.work_dir.iterdir()), [])

    def test_cancel_during_staging_copy_cleans_partials_and_preserves_library(self):
        previous_id = self.upload()['projectId']
        entered, release = threading.Event(), threading.Event()
        original_copy = server_module._copy_media
        def gated_copy(source, target, limit, cancel):
            entered.set()
            if not release.wait(2):
                raise RuntimeError('Test copy gate timed out')
            return original_copy(source, target, limit, cancel)
        with patch.object(server_module, '_copy_media', gated_copy):
            status, _, payload = self.request('POST', '/api/projects', b'fixture')
            self.assertEqual(status, 202)
            self.assertTrue(entered.wait(1))
            job_id = payload['job']['id']
            try:
                self.assertEqual(self.request('POST', f'/api/jobs/{job_id}/cancel', {})[0], 200)
            finally:
                release.set()
            self.assertEqual(self.wait_job(job_id)['status'], 'cancelled')
        self.assertEqual(list(self.server.projects), [previous_id])
        self.assertEqual(list(self.server.work_dir.iterdir()), [])
        self.assertFalse(self.server.jobs.busy())

    def test_disk_exhaustion_after_admission_cleans_partial_copy(self):
        previous_id = self.upload()['projectId']
        def no_space(source, target, limit, cancel):
            target.write_bytes(b'partial')
            raise OSError(errno.ENOSPC, 'No space left on device')
        with patch.object(server_module, '_copy_media', no_space):
            job = self.upload()
        self.assertEqual(job['status'], 'failed')
        self.assertIn('No space', job['error'])
        self.assertEqual(list(self.server.projects), [previous_id])
        self.assertEqual(list(self.server.work_dir.iterdir()), [])
        self.assertFalse(self.server.jobs.busy())

    def test_copy_cancellation_is_checked_between_bounded_blocks(self):
        source, target = self.root / 'source.bin', self.root / 'copy.bin'
        source.write_bytes(b'01234567' * 32768)
        class CancelAfterOneBlock:
            checks = 0
            def is_set(self):
                self.checks += 1
                return self.checks >= 4
        with self.assertRaisesRegex(RuntimeError, 'cancelled'):
            server_module._copy_media(source, target, 300000, CancelAfterOneBlock())
        self.assertEqual(target.read_bytes(), source.read_bytes()[:65536])
        target.unlink()
        server_module._copy_media(source, target, 300000, threading.Event())
        self.assertEqual(target.read_bytes(), source.read_bytes())

    def test_oversized_export_preserves_previous_completed_video(self):
        project_id = self.upload()['projectId']
        endpoint = f'/api/projects/{project_id}'
        self.request('PUT', endpoint, {'title': 'Saved', 'revision': 0,
                                      'cues': [dict(start=0, end=1, text='Line')]})
        first = self.request('POST', endpoint + '/export', {})[2]['job']
        self.assertEqual(self.wait_job(first['id'])['status'], 'complete')
        def oversized(project, backing, output, work_dir, font, cancel):
            with output.open('wb') as stream:
                stream.truncate(128 * 1024**2 + 1)
        self.server.export = oversized
        job = self.request('POST', endpoint + '/export', {})[2]['job']
        self.assertEqual(self.wait_job(job['id'])['status'], 'failed')
        self.assertEqual(self.request('GET', endpoint + '/video')[2], b'test-only MP4')
        self.assertEqual(list(self.server.work_dir.iterdir()), [])

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
                                      {"Content-Length": str(64 * 1024 * 1024 + 1)})[0], 413)
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
                                      {"Content-Length": str(256 * 1024 + 1)})[0], 413)
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

        def fail_stage(source, target, **kwargs):
            if source == project_id and kwargs.get("src_dir_fd") is not None:
                raise OSError("test rename failure")
            return original(source, target, **kwargs)

        with patch("karaoke.server.os.replace", side_effect=fail_stage):
            self.assertEqual(self.request("DELETE", endpoint, {})[0], 500)
        self.assertEqual(self.request("GET", endpoint)[2], baseline)
        self.assertEqual(self.request("GET", endpoint + "/audio/original")[0], 200)

    def test_replaced_projects_parent_refuses_reads_writes_and_selected_deletion(self):
        project_id = self.upload()["projectId"]
        original = self.server.projects[project_id].copy()
        owned = self.server.projects_dir
        retained = owned.with_name("retained-projects")
        owned.rename(retained)
        replacement = self.root / "outside-projects"
        replacement.mkdir()
        target = replacement / project_id
        target.mkdir()
        marker = target / "project.json"
        marker.write_text(json.dumps(original))
        (target / "source.wav").write_bytes(b"outside private audio")
        owned.symlink_to(replacement, target_is_directory=True)
        before = marker.read_bytes()
        endpoint = f"/api/projects/{project_id}"
        self.assertEqual(self.request("GET", endpoint + "/audio/original")[0], 409)
        self.assertEqual(self.request("PUT", endpoint, {"title": "replacement", "revision": 0, "cues": []})[0], 409)
        self.assertEqual(self.request("DELETE", endpoint, {})[0], 409)
        self.assertEqual(marker.read_bytes(), before)
        self.assertEqual((target / "source.wav").read_bytes(), b"outside private audio")
        self.assertEqual(self.server.projects[project_id], original)
        self.assertTrue((retained / project_id / "source.wav").is_file())

    def test_cancelled_job_cleanup_uses_owned_parent_after_jobs_path_replacement(self):
        started = threading.Event()
        def slow(source, media, model, cancel, stage):
            started.set()
            cancel.wait(3)
            raise RuntimeError("cancelled fixture")
        self.server.separate = slow
        status, _, result = self.request("POST", "/api/projects", b"audio")
        self.assertEqual(status, 202)
        self.assertTrue(started.wait(1))
        work_name = next(self.server.work_dir.iterdir()).name
        retained = self.server.work_dir.with_name("retained-jobs")
        self.server.work_dir.rename(retained)
        replacement = self.root / "outside-jobs"
        (replacement / work_name).mkdir(parents=True)
        marker = replacement / work_name / "input.audio"
        marker.write_bytes(b"unrelated work must survive")
        self.server.work_dir.symlink_to(replacement, target_is_directory=True)
        job_id = result["job"]["id"]
        self.assertEqual(self.request("POST", f"/api/jobs/{job_id}/cancel", {})[0], 200)
        self.assertEqual(self.wait_job(job_id)["status"], "cancelled")
        self.assertTrue(marker.exists(), "cleanup followed a replaced parent into unrelated data")
        self.assertEqual(marker.read_bytes(), b"unrelated work must survive")
        deadline = time.monotonic() + 1
        while (retained / work_name).exists() and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertFalse((retained / work_name).exists(), "owned temporary work leaked")

    def test_late_upload_publication_refuses_changed_projects_parent(self):
        started, finish = threading.Event(), threading.Event()
        def deferred(*args):
            started.set()
            self.assertTrue(finish.wait(3))
            return fake_separate(*args)
        self.server.separate = deferred
        status, _, result = self.request("POST", "/api/projects", b"audio")
        self.assertEqual(status, 202)
        self.assertTrue(started.wait(1))
        retained = self.server.projects_dir.with_name("retained-projects")
        self.server.projects_dir.rename(retained)
        replacement = self.root / "outside-projects"
        replacement.mkdir()
        marker = replacement / "unrelated.txt"
        marker.write_text("keep")
        self.server.projects_dir.symlink_to(replacement, target_is_directory=True)
        finish.set()
        job = self.wait_job(result["job"]["id"])
        self.assertEqual(job["status"], "failed")
        self.assertEqual(set(p.name for p in replacement.iterdir()), {"unrelated.txt"})
        self.assertEqual(marker.read_text(), "keep")
        self.assertEqual(self.server.projects, {})

    def test_delete_cleanup_stays_in_owned_trash_after_parent_replacement(self):
        project_id = self.upload()["projectId"]
        actual_replace = server_module.os.replace
        retained = self.server.trash_dir.with_name("retained-trash")
        replacement = self.root / "outside-trash"
        def replace_and_swap(source, target, **kwargs):
            result = actual_replace(source, target, **kwargs)
            if source == project_id or Path(source) == self.server.projects_dir / project_id:
                self.server.trash_dir.rename(retained)
                (replacement / Path(target).name).mkdir(parents=True)
                (replacement / Path(target).name / "unrelated.txt").write_text("keep")
                self.server.trash_dir.symlink_to(replacement, target_is_directory=True)
            return result
        with patch("karaoke.server.os.replace", side_effect=replace_and_swap):
            status, _, result = self.request("DELETE", f"/api/projects/{project_id}", {})
        self.assertEqual(status, 200, result)
        self.assertEqual([p.read_text() for p in replacement.rglob("unrelated.txt")], ["keep"])
        self.assertEqual(list(retained.iterdir()), [])
        self.assertNotIn(project_id, self.server.projects)

    def test_late_export_refuses_replaced_project_and_preserves_prior_video(self):
        project_id = self.upload()["projectId"]
        endpoint = f"/api/projects/{project_id}"
        self.request("PUT", endpoint, {"title": "saved", "revision": 0,
                                       "cues": [{"start": 0, "end": 1, "text": "lyrics"}]})
        first = self.request("POST", endpoint + "/export", {})[2]
        self.assertEqual(self.wait_job(first["job"]["id"])["status"], "complete")
        started, finish = threading.Event(), threading.Event()
        def deferred(project, backing, output, work_dir, font, cancel):
            started.set()
            self.assertTrue(finish.wait(3))
            output.write_bytes(b"replacement export")
        self.server.export = deferred
        status, _, second = self.request("POST", endpoint + "/export", {})
        self.assertEqual(status, 202)
        self.assertTrue(started.wait(1))
        original = self.server.projects_dir / project_id
        retained = self.server.projects_dir / ("retained-" + project_id)
        original.rename(retained)
        replacement = self.root / "outside-project"
        replacement.mkdir()
        marker = replacement / "unrelated.txt"
        marker.write_text("keep")
        original.symlink_to(replacement, target_is_directory=True)
        finish.set()
        self.assertEqual(self.wait_job(second["job"]["id"])["status"], "failed")
        self.assertEqual((retained / "video.mp4").read_bytes(), b"test-only MP4")
        self.assertEqual(set(p.name for p in replacement.iterdir()), {"unrelated.txt"})
        self.assertEqual(marker.read_text(), "keep")
        self.assertEqual(self.request("GET", endpoint)[0], 409)

    def test_running_separator_writes_through_owned_work_handle_after_parent_replacement(self):
        started, finish = threading.Event(), threading.Event()
        def deferred(*args):
            started.set()
            self.assertTrue(finish.wait(3))
            return fake_separate(*args)
        self.server.separate = deferred
        status, _, result = self.request("POST", "/api/projects", b"audio")
        self.assertEqual(status, 202)
        self.assertTrue(started.wait(1))
        name = next(self.server.work_dir.iterdir()).name
        retained = self.server.work_dir.with_name("retained-jobs")
        self.server.work_dir.rename(retained)
        replacement = self.root / "outside-jobs"
        (replacement / name / "media").mkdir(parents=True)
        marker = replacement / name / "media" / "unrelated.txt"
        marker.write_text("keep")
        self.server.work_dir.symlink_to(replacement, target_is_directory=True)
        finish.set()
        self.assertEqual(self.wait_job(result["job"]["id"])["status"], "failed")
        self.assertEqual(set(p.name for p in marker.parent.iterdir()), {"unrelated.txt"})
        self.assertEqual(marker.read_text(), "keep")
        self.assertEqual(list(retained.iterdir()), [])

    def test_project_list_rejects_replaced_individual_project_directory(self):
        project_id = self.upload()["projectId"]
        original = self.server.projects_dir / project_id
        original.rename(self.server.projects_dir / ("retained-" + project_id))
        original.mkdir()
        (original / "project.json").write_text(json.dumps(self.server.projects[project_id]))
        status, _, result = self.request("GET", "/api/projects")
        self.assertEqual(status, 409)
        self.assertIn("Restore", result["error"])

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

        def fail_marker(path, value, **kwargs):
            if path.name == "video-revision.json":
                raise OSError("test storage failure")
            atomic_json(path, value, **kwargs)

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
