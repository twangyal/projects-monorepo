"""Actual loopback archive transport, ownership and publication regressions."""
from __future__ import annotations

import hashlib
import io
import json
import os
import stat
from pathlib import Path
import tempfile
import threading
import unittest
import wave
import zipfile
from unittest.mock import patch

from karaoke import server as service
from karaoke.model import create_project
import test_server as server_fixtures

PROJECT_ID = 'a' * 32


def archive_bytes(project=None):
    """Independent stored ZIP fixture, not the production archive producer."""
    project = project or create_project(PROJECT_ID, 'Saved <歌> clip', 1.0)
    wav = io.BytesIO()
    with wave.open(wav, 'wb') as audio:
        audio.setparams((2, 2, 44100, 0, 'NONE', 'not compressed'))
        audio.writeframes(b'\x01\x00\x02\x00' * 44100)
    files = [('project.json', json.dumps(project, ensure_ascii=False).encode())]
    files += [(name, wav.getvalue()) for name in ('source.wav', 'vocals.wav', 'backing.wav')]
    manifest = dict(schemaVersion=1, kind='karaoke-studio-project', origin='local-library',
                    audio=dict(sampleRate=44100, channels=2, sampleWidth=2, frames=44100),
                    files=[dict(name=name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
                           for name, data in files])
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name, data in [*files, ('manifest.json', json.dumps(manifest).encode())]:
            entry = zipfile.ZipInfo(name)
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | 0o600) << 16
            archive.writestr(entry, data)
    return output.getvalue()


class ArchiveServerTests(unittest.TestCase):
    request = server_fixtures.ServerTests.request
    wait_job = server_fixtures.ServerTests.wait_job
    start_server = server_fixtures.ServerTests.start_server

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dist = self.root / 'dist'
        self.dist.mkdir()
        (self.dist / 'index.html').write_text('archive fixture')
        directory = self.root / 'data' / 'projects' / PROJECT_ID
        directory.mkdir(parents=True)
        self.project = create_project(PROJECT_ID, 'Saved <歌> clip', 1.0)
        self.project['revision'] = 7
        (directory / 'project.json').write_text(json.dumps(self.project), encoding='utf8')
        with zipfile.ZipFile(io.BytesIO(archive_bytes(self.project))) as archive:
            for name in ('source.wav', 'vocals.wav', 'backing.wav'):
                (directory / name).write_bytes(archive.read(name))
        self.directory = directory
        def forbidden(*_args):
            raise AssertionError('Archive path must never invoke separation')
        self.server = self.start_server(ready=lambda _: False, separate=forbidden)
        self.token = self.server.token

    def import_job(self, data=None):
        status, _, result = self.request('POST', '/api/archives', data or archive_bytes(self.project),
                                        {'Content-Type': 'application/zip'})
        self.assertEqual(status, 202, result)
        return self.wait_job(result['job']['id'])

    def export_job(self):
        status, _, result = self.request('POST', f'/api/projects/{PROJECT_ID}/archive', {'revision': 7})
        self.assertEqual(status, 202, result)
        return self.wait_job(result['job']['id'])

    def test_no_model_export_import_exact_audio_saved_fields_and_provenance(self):
        self.assertEqual(self.request('GET', '/api/session')[2]['maxArchiveBytes'], 160 * 1024**2)
        exported = self.export_job()
        self.assertEqual(exported['status'], 'complete', exported)
        self.assertEqual(exported['kind'], 'archive-export')
        status, headers, raw = self.request('GET', exported['resultUrl'])
        self.assertEqual(status, 200)
        self.assertIn('.karaoke.zip', headers['Content-Disposition'])
        restored = self.import_job(raw)
        self.assertEqual(restored['status'], 'complete', restored)
        self.assertEqual(restored['kind'], 'archive-import')
        fresh = restored['projectId']
        self.assertNotEqual(fresh, PROJECT_ID)
        self.assertEqual(restored['resultUrl'], f'/api/projects/{fresh}')
        saved = self.request('GET', restored['resultUrl'])[2]
        self.assertEqual(saved, {**self.project, 'id': fresh})
        for kind, name in service._AUDIO_FILES.items():
            self.assertEqual(self.request('GET', f'/api/projects/{fresh}/audio/{kind}')[2],
                             (self.directory / name).read_bytes())
        info = self.request('GET', f'/api/projects/{fresh}/archive-info')[2]
        self.assertEqual(info, dict(imported=True, processingSupplied=False, origin='imported-declared',
                                   sourceProjectId=PROJECT_ID, sourceRevision=7,
                                   archiveSha256=hashlib.sha256(raw).hexdigest()))
        self.assertFalse(self.server.uploading)
        self.assertEqual(list(self.server.work_dir.iterdir()), [])

    def test_native_ranges_head_and_saved_revision_staleness(self):
        self.assertEqual(self.export_job()['status'], 'complete')
        path = f'/api/projects/{PROJECT_ID}/archive'
        raw = self.request('GET', path)[2]
        status, headers, part = self.request('GET', path, headers={'Range': 'bytes=10-29'})
        self.assertEqual((status, part), (206, raw[10:30]))
        self.assertEqual(headers['Content-Range'], f'bytes 10-29/{len(raw)}')
        self.assertEqual(self.request('HEAD', path)[2], b'')
        update = {key: self.project[key] for key in ('title', 'cues', 'revision')}
        self.assertEqual(self.request('PUT', f'/api/projects/{PROJECT_ID}', update)[0], 200)
        self.assertEqual(self.request('GET', path)[0], 409)
        self.assertTrue((self.directory / 'archive.karaoke.zip').is_file())

    def test_strict_revision_and_transport_preflight_preserve_library(self):
        path = f'/api/projects/{PROJECT_ID}/archive'
        for value in ({}, {'revision': True}, {'revision': -1}, {'revision': 2147483648},
                      {'revision': 7, 'extra': 1}):
            self.assertEqual(self.request('POST', path, value)[0], 400)
        self.assertEqual(self.request('POST', path, {'revision': 6})[0], 409)
        for headers, expected in [({'Content-Type': 'text/plain'}, 400),
                                  ({'Content-Type': 'application/zip', 'Content-Length': str(160*1024**2+1)}, 413),
                                  ({'Content-Type': 'application/zip', 'Transfer-Encoding': 'chunked'}, 400),
                                  ({'Content-Type': 'application/zip', 'X-Karaoke-Token': 'wrong'}, 403)]:
            self.assertEqual(self.request('POST', '/api/archives', b'x', headers)[0], expected)
        self.assertEqual(len(self.server.projects), 1)
        self.assertFalse(self.server.uploading)
        self.assertEqual(list(self.server.work_dir.iterdir()), [])

    def test_malformed_archive_is_failed_job_and_cleanup_not_library_loss(self):
        job = self.import_job(b'not a ZIP')
        self.assertEqual(job['status'], 'failed', job)
        self.assertEqual(list(self.server.projects), [PROJECT_ID])
        self.assertEqual(list(self.server.work_dir.iterdir()), [])

    def test_archive_info_failure_does_not_block_ordinary_open(self):
        (self.directory / 'archive-origin.json').write_text('{}')
        self.assertEqual(self.request('GET', f'/api/projects/{PROJECT_ID}/archive-info')[0], 409)
        self.assertEqual(self.request('GET', f'/api/projects/{PROJECT_ID}')[0], 200)
        self.assertEqual(self.request('GET', f'/api/projects/{PROJECT_ID}/audio/original')[0], 200)

    def test_restore_unsupported_rejected_before_upload_or_job(self):
        with patch.object(service, '_require_archive_restore_support', side_effect=service.RequestError(503, 'Linux restore support unavailable.')):
            self.assertEqual(self.request('POST', '/api/archives', b'x', {'Content-Type': 'application/zip'})[0], 503)
        self.assertIsNone(self.server.jobs.active())
        self.assertFalse(self.server.uploading)

    def test_raced_empty_destination_is_never_overwritten(self):
        original = service._rename_noreplace
        def raced(source_fd, source_name, destination_fd, destination_name):
            os.mkdir(destination_name, dir_fd=destination_fd)
            return original(source_fd, source_name, destination_fd, destination_name)
        with patch.object(service, '_rename_noreplace', side_effect=raced):
            job = self.import_job()
        self.assertEqual(job['status'], 'failed', job)
        self.assertTrue((self.server.projects_dir / job['projectId']).is_dir())
        self.assertEqual(list((self.server.projects_dir / job['projectId']).iterdir()), [])
        self.assertEqual(list(self.server.projects), [PROJECT_ID])
        self.assertEqual(list(self.server.work_dir.iterdir()), [])

    def test_archive_export_busy_edit_delete_cancel_and_previous_cache_retention(self):
        self.assertEqual(self.export_job()['status'], 'complete')
        previous = (self.directory / 'archive.karaoke.zip').read_bytes()
        reached, release = threading.Event(), threading.Event()
        original = service.export_archive
        def held(*args):
            result = original(*args)
            reached.set()
            release.wait(3)
            return result
        self.addCleanup(release.set)
        with patch.object(service, 'export_archive', side_effect=held):
            status, _, payload = self.request('POST', f'/api/projects/{PROJECT_ID}/archive', {'revision': 7})
            self.assertEqual(status, 202)
            self.assertTrue(reached.wait(2))
            update = {key: self.project[key] for key in ('title', 'cues', 'revision')}
            self.assertEqual(self.request('PUT', f'/api/projects/{PROJECT_ID}', update)[0], 409)
            self.assertEqual(self.request('DELETE', f'/api/projects/{PROJECT_ID}', {})[0], 409)
            self.assertEqual(self.request('POST', '/api/archives', b'x', {'Content-Type': 'application/zip'})[0], 409)
            self.request('POST', f"/api/jobs/{payload['job']['id']}/cancel", {})
            release.set()
            self.assertEqual(self.wait_job(payload['job']['id'])['status'], 'cancelled')
        self.assertEqual((self.directory / 'archive.karaoke.zip').read_bytes(), previous)
        self.assertEqual(list(self.server.work_dir.iterdir()), [])

    def test_failed_cache_replace_retains_previous_cache(self):
        self.assertEqual(self.export_job()['status'], 'complete')
        previous = (self.directory / 'archive.karaoke.zip').read_bytes()
        original = service.os.replace
        def failing(source, destination, **kwargs):
            if destination == 'archive.karaoke.zip':
                raise OSError('injected cache publication failure')
            return original(source, destination, **kwargs)
        with patch.object(service.os, 'replace', side_effect=failing):
            self.assertEqual(self.export_job()['status'], 'failed')
        self.assertEqual((self.directory / 'archive.karaoke.zip').read_bytes(), previous)
        self.assertEqual(list(self.server.work_dir.iterdir()), [])

    def test_replaced_engine_output_receipt_is_rejected_for_file_and_directory(self):
        for importing in (False, True):
            with self.subTest(importing=importing):
                name = 'import_archive' if importing else 'export_archive'
                original = getattr(service, name)
                def replaced(*args):
                    result = original(*args)
                    fd = args[0] if importing else args[2]
                    child = 'completed' if importing else 'export.karaoke.zip'
                    os.rename(child, 'original-output', src_dir_fd=fd, dst_dir_fd=fd)
                    if importing:
                        os.mkdir(child, dir_fd=fd)
                    else:
                        new_fd = os.open(child, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=fd)
                        os.write(new_fd, b'replaced output')
                        os.close(new_fd)
                    return result
                with patch.object(service, name, side_effect=replaced):
                    job = self.import_job() if importing else self.export_job()
                self.assertEqual(job['status'], 'failed', job)
                self.assertIn('changed', job['error'])
                self.assertEqual(list(self.server.projects), [PROJECT_ID])
                self.assertEqual(list(self.server.work_dir.iterdir()), [])
        self.assertFalse((self.directory / 'archive.karaoke.zip').exists())

    def test_pinned_download_does_not_hold_publication_lock_or_switch_snapshot(self):
        self.assertEqual(self.export_job()['status'], 'complete')
        path = f'/api/projects/{PROJECT_ID}/archive'
        previous = self.request('GET', path)[2]
        reached, release = threading.Event(), threading.Event()
        original = service.Handler._stream_file
        responses = []
        def held(handler, source, content_type, **kwargs):
            if content_type == 'application/zip':
                reached.set()
                release.wait(3)
            return original(handler, source, content_type, **kwargs)
        self.addCleanup(release.set)
        with patch.object(service.Handler, '_stream_file', held):
            thread = threading.Thread(target=lambda: responses.append(self.request('GET', path)))
            thread.start()
            try:
                self.assertTrue(reached.wait(2))
                update = {key: self.project[key] for key in ('title', 'cues', 'revision')}
                update['title'] = 'New saved title'
                self.assertEqual(self.request('PUT', f'/api/projects/{PROJECT_ID}', update)[0], 200)
            finally:
                release.set()
                thread.join(3)
        self.assertEqual(responses[0][0], 200)
        self.assertEqual(responses[0][2], previous)
        self.assertNotIn('New saved title', responses[0][1]['Content-Disposition'])
        self.assertEqual(self.request('GET', path)[0], 409)

    def test_quota_and_free_space_reject_before_body_job_and_at_publication(self):
        with patch.object(service, 'MAX_PROJECTS', 1):
            self.assertEqual(self.request('POST', '/api/archives', b'x', {'Content-Type': 'application/zip'})[0], 409)
        from types import SimpleNamespace
        with patch.object(service.os, 'fstatvfs', return_value=SimpleNamespace(f_bavail=0, f_frsize=4096)):
            self.assertEqual(self.request('POST', '/api/archives', b'x', {'Content-Type': 'application/zip'})[0], 507)
        self.assertFalse(self.server.uploading)
        self.assertIsNone(self.server.jobs.active())
        original = service.import_archive
        def now_full(*args):
            result = original(*args)
            self.server.projects['b' * 32] = self.project.copy()
            return result
        with patch.object(service, 'MAX_PROJECTS', 2), patch.object(service, 'import_archive', side_effect=now_full):
            job = self.import_job()
        self.assertEqual(job['status'], 'failed', job)
        self.assertFalse((self.server.projects_dir / job['projectId']).exists())
        self.assertEqual(list(self.server.work_dir.iterdir()), [])

    def test_import_cancel_before_publication_has_no_visible_clip(self):
        reached, release = threading.Event(), threading.Event()
        original = service.import_archive
        def held(*args):
            result = original(*args)
            reached.set()
            release.wait(3)
            return result
        self.addCleanup(release.set)
        with patch.object(service, 'import_archive', side_effect=held):
            status, _, payload = self.request('POST', '/api/archives', archive_bytes(self.project),
                                             {'Content-Type': 'application/octet-stream'})
            self.assertEqual(status, 202)
            self.assertTrue(reached.wait(2))
            self.request('POST', f"/api/jobs/{payload['job']['id']}/cancel", {})
            release.set()
            job = self.wait_job(payload['job']['id'])
        self.assertEqual(job['status'], 'cancelled', job)
        self.assertEqual(list(self.server.projects), [PROJECT_ID])
        self.assertFalse((self.server.projects_dir / job['projectId']).exists())
        self.assertEqual(list(self.server.work_dir.iterdir()), [])

    def test_shutdown_aborts_reserved_upload_before_closing_owned_storage(self):
        import http.client
        import time
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=2)
        self.addCleanup(connection.close)
        connection.putrequest('POST', '/api/archives')
        connection.putheader('Content-Type', 'application/zip')
        connection.putheader('Content-Length', '100000')
        connection.putheader('X-Karaoke-Token', self.token)
        connection.endheaders()
        connection.send(b'PK')
        deadline = time.monotonic() + 2
        while not self.server.uploading and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertTrue(self.server.uploading)
        self.server.shutdown()
        self.server.server_close()
        self.assertFalse(self.server.uploading)
        self.assertEqual(list((self.root / 'data' / '.jobs').iterdir()), [])

    def test_restart_preserves_imported_provenance_and_reexport_unverified(self):
        restored = self.import_job()
        self.assertEqual(restored['status'], 'complete', restored)
        fresh = restored['projectId']
        self.server.shutdown()
        self.server.server_close()
        self.server = self.start_server(ready=lambda _: False)
        self.token = self.server.token
        info = self.request('GET', f'/api/projects/{fresh}/archive-info')[2]
        self.assertEqual(info['origin'], 'imported-declared')
        status, _, payload = self.request('POST', f'/api/projects/{fresh}/archive', {'revision': 7})
        self.assertEqual(status, 202)
        self.assertEqual(self.wait_job(payload['job']['id'])['status'], 'complete')
        raw = self.request('GET', f'/api/projects/{fresh}/archive')[2]
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            self.assertEqual(json.loads(archive.read('manifest.json'))['origin'], 'imported-declared')


    def test_changed_parent_or_source_directory_rejects_publication_with_owned_cleanup(self):
        for changed in ('work', 'projects', 'source'):
            with self.subTest(changed=changed):
                original = service.export_archive
                moved = self.root / ('moved-' + changed)
                path = {'work': self.server.work_dir, 'projects': self.server.projects_dir,
                        'source': self.directory}[changed]
                def replaced(*args):
                    result = original(*args)
                    path.rename(moved)
                    path.mkdir()
                    (path / 'unrelated').write_bytes(b'preserve sibling')
                    return result
                try:
                    with patch.object(service, 'export_archive', side_effect=replaced):
                        job = self.export_job()
                    self.assertEqual(job['status'], 'failed', job)
                    self.assertEqual((path / 'unrelated').read_bytes(), b'preserve sibling')
                    self.assertEqual(list(self.server.projects), [PROJECT_ID])
                    owned_work = moved if changed == 'work' else self.server.work_dir
                    self.assertEqual(list(owned_work.iterdir()), [])
                finally:
                    (path / 'unrelated').unlink(missing_ok=True)
                    path.rmdir()
                    moved.rename(path)
        self.assertFalse((self.directory / 'archive.karaoke.zip').exists())

    def test_no_fallible_project_filesystem_operation_after_restore_rename(self):
        original_rename, original_stat = service._rename_noreplace, service.os.stat
        published = set()
        def rename(source_fd, source, destination_fd, destination):
            original_rename(source_fd, source, destination_fd, destination)
            published.add(destination)
        def guarded_stat(path, *args, **kwargs):
            if isinstance(path, str) and path in published:
                raise AssertionError('Publication must use the pre-acquired directory identity')
            return original_stat(path, *args, **kwargs)
        with patch.object(service, '_rename_noreplace', side_effect=rename), patch.object(service.os, 'stat', side_effect=guarded_stat):
            job = self.import_job()
        self.assertEqual(job['status'], 'complete', job)
        self.assertEqual(self.server._project_identities[job['projectId']],
                         self.server._identity((self.server.projects_dir / job['projectId']).stat()))

    def test_streamed_archive_absolute_deadline_cleans_reservation(self):
        import socket
        import time
        connection = socket.create_connection(('127.0.0.1', self.server.server_port), timeout=2)
        self.addCleanup(connection.close)
        headers = (f'POST /api/archives HTTP/1.1\r\nHost: 127.0.0.1:{self.server.server_port}\r\n'
                   f'X-Karaoke-Token: {self.token}\r\nContent-Type: application/zip\r\n'
                   'Content-Length: 10000\r\nConnection: close\r\n\r\n')
        with patch.object(service, 'UPLOAD_TIMEOUT', .06):
            connection.sendall(headers.encode() + b'PK')
            for _ in range(4):
                time.sleep(.025)
                try:
                    connection.sendall(b'x')
                except OSError:
                    break
            response = connection.recv(4096)
        self.assertIn(b'408', response.split(b'\r\n')[0])
        deadline = time.monotonic() + 1
        while self.server.uploading and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertFalse(self.server.uploading)
        self.assertEqual(list(self.server.work_dir.iterdir()), [])
        self.assertIsNone(self.server.jobs.active())

    def test_archive_security_origin_fetch_metadata_and_missing_length(self):
        for headers in ({'Origin': 'http://evil.invalid'}, {'Sec-Fetch-Site': 'cross-site'},
                        {'Host': 'evil.invalid'}, {'Content-Length': '0'}):
            merged = {'Content-Type': 'application/zip', **headers}
            expected = 400 if 'Content-Length' in headers else 403
            self.assertEqual(self.request('POST', '/api/archives', b'x', merged)[0], expected)
        self.assertEqual(list(self.server.projects), [PROJECT_ID])
        self.assertFalse(self.server.uploading)


    def test_archive_content_length_above_audio_limit_is_admitted_without_buffering(self):
        import socket
        import time
        connection = socket.create_connection(('127.0.0.1', self.server.server_port), timeout=2)
        self.addCleanup(connection.close)
        headers = (f'POST /api/archives HTTP/1.1\r\nHost: 127.0.0.1:{self.server.server_port}\r\n'
                   f'X-Karaoke-Token: {self.token}\r\nContent-Type: application/zip\r\n'
                   f'Content-Length: {64 * 1024**2 + 1}\r\nConnection: close\r\n\r\n')
        connection.sendall(headers.encode() + b'PK')
        deadline = time.monotonic() + 1
        while not self.server.uploading and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertTrue(self.server.uploading, 'Archive has its own larger header admission bound')
        connection.shutdown(socket.SHUT_WR)
        self.assertIn(b'400', connection.recv(4096).split(b'\r\n')[0])
        deadline = time.monotonic() + 1
        while self.server.uploading and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertFalse(self.server.uploading)
        self.assertEqual(list(self.server.work_dir.iterdir()), [])

if __name__ == '__main__':
    unittest.main()
