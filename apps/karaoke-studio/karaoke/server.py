"""Loopback HTTP service for local projects; never serves arbitrary paths."""

from __future__ import annotations

import argparse
from collections.abc import Callable
import hmac
import fcntl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import tempfile
import threading
from urllib.parse import unquote, urlsplit
import uuid

from .jobs import JobBusy, JobManager
from .model import MAX_DURATION, ValidationError, create_project, render_srt, update_project, validate_project

MAX_UPLOAD = 20 * 1024 * 1024
MAX_JSON = 64 * 1024
MAX_PROJECTS = 20
_ID = r"[0-9a-f]{32}"
_PROJECT_ROUTE = re.compile(rf"/api/projects/({_ID})(?:/(audio/(original|vocals|backing)|lyrics|video|export))?")
_JOB_ROUTE = re.compile(rf"/api/jobs/({_ID})(/cancel)?")
_AUDIO_FILES = {"original": "source.wav", "vocals": "vocals.wav", "backing": "backing.wav"}


class RequestError(Exception):
    def __init__(self, status: int, message: str):
        self.status, self.message = status, message
        super().__init__(message)


def _atomic_json(path: Path, value: dict):
    data = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".save-", dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


class KaraokeServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def __init__(self, data_dir, model_dir, port, *, dist_dir, font_path, separate, export, ready):
        self.data_dir = Path(data_dir).expanduser().resolve()
        self.model_dir = Path(model_dir).expanduser().resolve()
        self.dist_dir = Path(dist_dir).resolve()
        self.font_path = Path(font_path).resolve()
        self.separate, self.export, self.ready = separate, export, ready
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.RLock()
        self.jobs = JobManager(self.lock)
        self.uploading = False
        self.projects_dir = self.data_dir / "projects"
        self.work_dir = self.data_dir / ".jobs"
        self.trash_dir = self.data_dir / ".trash"
        self._data_lock = None
        self.data_dir.mkdir(parents=True, exist_ok=True)
        lock_path = self.data_dir / ".server.lock"
        if lock_path.is_symlink():
            raise ValueError("Data-directory lock must not be a symbolic link")
        lock_file = lock_path.open("a+b")
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            lock_file.close()
            raise RuntimeError("Data directory is already in use by another Karaoke Studio service.") from None
        except BaseException:
            lock_file.close()
            raise
        self._data_lock = lock_file
        try:
            self._initialize_data()
            super().__init__(("127.0.0.1", port), Handler)
        except BaseException:
            self._release_data_lock()
            raise

    def _initialize_data(self):
        # The exclusive lock is acquired BEFORE touching unfinished job files.
        for directory in (self.projects_dir, self.work_dir, self.trash_dir):
            if directory.is_symlink():
                raise ValueError("Data directories must not be symbolic links")
            directory.mkdir(parents=True, exist_ok=True)
        # Incomplete work is disposable; completed project directories are never
        # removed at startup or when the project quota has been reached.
        for child in self.work_dir.iterdir():
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink()
        self.projects: dict[str, dict] = {}
        for child in self.projects_dir.iterdir():
            if not re.fullmatch(_ID, child.name) or child.is_symlink():
                continue
            path = child / "project.json"
            try:
                if path.is_symlink() or path.stat().st_size > MAX_JSON:
                    continue
                project = validate_project(json.loads(path.read_text("utf-8")))
                if project["id"] == child.name:
                    self.projects[child.name] = project
            except (OSError, ValueError, TypeError):
                continue

    def _release_data_lock(self):
        if self._data_lock is not None:
            fcntl.flock(self._data_lock.fileno(), fcntl.LOCK_UN)
            self._data_lock.close()
            self._data_lock = None

    def model_ready(self):
        try:
            return bool(self.ready(self.model_dir))
        except Exception:
            return False

    def server_close(self):
        try:
            self.jobs.shutdown()
        finally:
            try:
                if hasattr(self, "socket"):
                    super().server_close()
            finally:
                self._release_data_lock()

    def project(self, project_id):
        try:
            return self.projects[project_id]
        except KeyError:
            raise RequestError(404, "Project not found.") from None

    def delete_project(self, project_id):
        with self.lock:
            self.project(project_id)
            active = self.jobs.active()
            if active and active["projectId"] == project_id:
                raise RequestError(409, "This project has an active media job; wait or cancel it before deleting.")
            staged = self.trash_dir / uuid.uuid4().hex
            os.replace(self.projects_dir / project_id, staged)
            del self.projects[project_id]
        result = {"deleted": True, "projectId": project_id}
        try:
            # Only this explicitly selected project is removed. Cleanup cannot
            # hold the state lock or touch any completed sibling project.
            shutil.rmtree(staged)
        except OSError:
            result["cleanupPending"] = True
        return result

    def upload(self, title: str, upload: Path, work_dir: Path):
        project_id = uuid.uuid4().hex

        def work(cancel, stage):
            media = work_dir / "media"
            media.mkdir()
            duration = self.separate(upload, media, self.model_dir, cancel, stage)
            project = create_project(project_id, title, duration)
            complete = work_dir / "completed"
            complete.mkdir()
            for name in _AUDIO_FILES.values():
                source = media / name
                if source.is_symlink() or not source.is_file():
                    raise RuntimeError("Audio processing did not produce all three WAV files.")
                shutil.copyfile(source, complete / name)
            metadata = media / "processing.json"
            if metadata.exists():
                if metadata.is_symlink() or not metadata.is_file() or metadata.stat().st_size > 16384:
                    raise RuntimeError("Audio processing provenance is invalid or oversized.")
                shutil.copyfile(metadata, complete / "processing.json")
            _atomic_json(complete / "project.json", project)

            def publish():
                if len(self.projects) >= MAX_PROJECTS:
                    raise RuntimeError("Project storage is full; completed projects were preserved.")
                os.replace(complete, self.projects_dir / project_id)
                self.projects[project_id] = project
                return None

            return publish

        return self.jobs.start(project_id, "separate", work, lambda: shutil.rmtree(work_dir, ignore_errors=True))

    def start_export(self, project: dict):
        if self.uploading:
            raise JobBusy("An audio upload is in progress. Wait before exporting.")
        project = validate_project(project)
        if not project["cues"]:
            raise RequestError(400, "Add and timestamp lyric lines, then save before exporting a video.")
        work_dir = self.work_dir / uuid.uuid4().hex
        work_dir.mkdir()
        project_dir = self.projects_dir / project["id"]

        def work(cancel, stage):
            stage("Rendering lyric video")
            output = work_dir / "video.mp4"
            self.export(project, project_dir / "backing.wav", output, work_dir, self.font_path, cancel)
            if output.is_symlink() or not output.is_file() or not output.stat().st_size:
                raise RuntimeError("Video export did not produce a complete output.")

            def publish():
                if self.project(project["id"])["revision"] != project["revision"]:
                    raise RuntimeError("Saved project changed during export; export again.")
                target = project_dir / "video.mp4"
                backup = project_dir / ".previous-video.mp4"
                if backup.exists():
                    raise RuntimeError("A previous video backup requires recovery before exporting again.")
                previous = target.exists()
                if previous:
                    os.replace(target, backup)
                try:
                    os.replace(output, target)
                    _atomic_json(project_dir / "video-revision.json", {"revision": project["revision"]})
                except Exception:
                    # Both files are published under the state lock. Restore an
                    # existing completed video if its marker cannot be saved.
                    # A recovery backup lives outside disposable job work.
                    if previous:
                        os.replace(backup, target)
                    else:
                        target.unlink(missing_ok=True)
                    raise
                if previous:
                    try:
                        backup.unlink()
                    except OSError:
                        pass
                return f'/api/projects/{project["id"]}/video'

            return publish

        try:
            return self.jobs.start(project["id"], "export", work,
                                   lambda: shutil.rmtree(work_dir, ignore_errors=True))
        except Exception:
            shutil.rmtree(work_dir, ignore_errors=True)
            raise


class Handler(BaseHTTPRequestHandler):
    server: KaraokeServer
    server_version = "KaraokeStudio"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_args):
        # URLs, local file names and user media must not become request logs.
        pass

    def do_GET(self):
        self._dispatch()

    def do_HEAD(self):
        self._dispatch()

    def do_POST(self):
        self._dispatch()

    def do_PUT(self):
        self._dispatch()

    def do_OPTIONS(self):
        self._dispatch()

    def do_DELETE(self):
        self._dispatch()

    def _headers(self, status, content_type, length, *, disposition=None, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; "
                         "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                         "media-src 'self' blob:; connect-src 'self'; object-src 'none'; "
                         "base-uri 'none'; frame-ancestors 'none'")
        if disposition:
            self.send_header("Content-Disposition", disposition)
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()

    def _bytes(self, data, content_type, status=200, *, disposition=None):
        self._headers(status, content_type, len(data), disposition=disposition)
        if self.command != "HEAD":
            self.wfile.write(data)

    def _json(self, value, status=200):
        self._bytes(json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8"),
                    "application/json; charset=utf-8", status)

    def _error(self, status, message):
        try:
            self._json({"error": message}, status)
        except OSError:
            # A cancelled browser upload may have already closed its socket.
            pass

    def _security(self):
        hosts = self.headers.get_all("Host", [])
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if self.server.server_port == 80:
            allowed.update({"127.0.0.1", "localhost"})
        if len(hosts) != 1 or hosts[0] not in allowed:
            raise RequestError(403, "Requests must use this service's loopback Host.")
        origins = self.headers.get_all("Origin", [])
        if len(origins) > 1 or (origins and origins[0] != f"http://{hosts[0]}"):
            raise RequestError(403, "Cross-origin requests are not allowed.")
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            raise RequestError(403, "Cross-site requests are not allowed.")
        if self.command not in {"GET", "HEAD"}:
            tokens = self.headers.get_all("X-Karaoke-Token", [])
            if (len(tokens) != 1 or not hmac.compare_digest(
                    tokens[0].encode("utf-8"), self.server.token.encode("ascii"))):
                raise RequestError(403, "A valid session token is required for writes.")

    def _length(self, limit, *, empty=False):
        if self.headers.get("Transfer-Encoding") is not None:
            raise RequestError(400, "Chunked request bodies are not supported; provide Content-Length.")
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1:
            raise RequestError(411, "Content-Length is required.")
        if not re.fullmatch(r"[0-9]+", lengths[0]) or len(lengths[0]) > 12:
            raise RequestError(400, "Content-Length must be a nonnegative integer.")
        length = int(lengths[0])
        if length > limit:
            raise RequestError(413, "Request body exceeds the size limit.")
        if not length and not empty:
            raise RequestError(400, "Request body must not be empty.")
        return length

    def _body(self, length):
        body = self.rfile.read(length)
        if len(body) != length:
            raise RequestError(400, "Request body was incomplete.")
        return body

    def _read_json(self, *, empty=False):
        length = self._length(MAX_JSON, empty=empty)
        if not length and empty:
            return {}
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise RequestError(400, "Use application/json for this request.")

        def pairs(items):
            result = {}
            for key, value in items:
                if key in result:
                    raise ValueError("Duplicate JSON key")
                result[key] = value
            return result

        def invalid_constant(_value):
            raise ValueError("Nonfinite JSON number")

        try:
            value = json.loads(self._body(length).decode("utf-8"),
                               object_pairs_hook=pairs, parse_constant=invalid_constant)
        except (ValueError, UnicodeError, RecursionError):
            raise RequestError(400, "Request body must contain valid UTF-8 JSON.") from None
        if not isinstance(value, dict):
            raise RequestError(400, "JSON request body must be an object.")
        return value

    def _attachment(self, title, suffix):
        stem = re.sub(r"[^A-Za-z0-9._ -]", "_", title).strip(" .")[:80] or "karaoke"
        return f'attachment; filename="{stem}{suffix}"'

    def _file(self, path: Path, content_type, *, disposition=None):
        with self.server.lock:
            if path.is_symlink() or not path.is_file():
                raise RequestError(404, "Requested media file is not available.")
            source = path.open("rb")
        with source:
            total = os.fstat(source.fileno()).st_size
            start, end, status = 0, total - 1, 200
            headers = {"Accept-Ranges": "bytes"}
            ranges = self.headers.get_all("Range", [])
            if ranges:
                value = ranges[0].strip()
                match = re.fullmatch(r"bytes=([0-9]{0,20})-([0-9]{0,20})", value) if len(value) < 128 else None
                valid = len(ranges) == 1 and match is not None and total > 0
                if valid:
                    first, last = match.groups()
                    if not first:
                        count = int(last) if last else 0
                        valid = count > 0
                        start = max(0, total - count)
                    else:
                        start = int(first)
                        end = min(int(last), total - 1) if last else total - 1
                        valid = start < total and end >= start
                if not valid:
                    self._headers(416, content_type, 0,
                                  extra={**headers, "Content-Range": f"bytes */{total}"})
                    return
                status = 206
                headers["Content-Range"] = f"bytes {start}-{end}/{total}"
            remaining = max(0, end - start + 1)
            self._headers(status, content_type, remaining, disposition=disposition, extra=headers)
            if self.command != "HEAD":
                source.seek(start)
                while remaining:
                    chunk = source.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)

    def _dispatch(self):
        try:
            self._security()
            if self.command not in {"GET", "HEAD", "POST", "PUT", "DELETE"}:
                raise RequestError(405, "Method not supported.")
            parsed = urlsplit(self.path)
            if parsed.scheme or parsed.netloc or re.search(r"%(?![0-9a-fA-F]{2})", parsed.path):
                raise RequestError(400, "Invalid request path.")
            try:
                path = unquote(parsed.path, errors="strict")
            except UnicodeError:
                raise RequestError(400, "Invalid UTF-8 request path.") from None
            if "\0" in path or "\\" in path or any(part in {".", ".."} for part in path.split("/")):
                raise RequestError(404, "Path not found.")
            self._route(path)
        except RequestError as error:
            self._error(error.status, error.message)
        except ValidationError as error:
            self._error(400, str(error))
        except JobBusy as error:
            self._error(409, str(error))
        except (socket.timeout, TimeoutError):
            self._error(408, "Request body timed out.")
        except (BrokenPipeError, ConnectionResetError):
            pass
        except (OSError, UnicodeError, ValueError):
            self._error(500, "The local request could not be completed.")

    def _route(self, path):
        read = self.command in {"GET", "HEAD"}
        server = self.server
        if path == "/api/session" and read:
            self._json(dict(token=server.token, modelReady=server.model_ready(),
                            maxDuration=MAX_DURATION, maxProjects=MAX_PROJECTS,
                            activeJob=server.jobs.active()))
            return
        if path == "/api/projects":
            if read:
                with server.lock:
                    projects = sorted(server.projects.values(),
                                      key=lambda project: (server.projects_dir / project["id"] / "project.json").stat().st_mtime_ns,
                                      reverse=True)
                self._json({"projects": projects})
                return
            if self.command == "POST":
                self._upload()
                return
        job_match = _JOB_ROUTE.fullmatch(path)
        if job_match:
            job_id, cancel = job_match.groups()
            try:
                if read and not cancel:
                    self._json({"job": server.jobs.get(job_id)})
                    return
                if self.command == "POST" and cancel:
                    if self._read_json(empty=True):
                        raise RequestError(400, "Cancellation takes an empty JSON object.")
                    self._json({"job": server.jobs.cancel(job_id)})
                    return
            except KeyError:
                raise RequestError(404, "Job not found or no longer retained.") from None
        project_match = _PROJECT_ROUTE.fullmatch(path)
        if project_match:
            project_id, resource, stem = project_match.groups()
            if self.command == "DELETE" and resource is None:
                if self._read_json():
                    raise RequestError(400, "Delete takes an empty JSON object.")
                self._json(server.delete_project(project_id))
                return
            # Read request bodies before acquiring the publication lock. A slow
            # client must not stop polling, cancellation or completed playback.
            value = None
            if self.command == "PUT" and resource is None:
                value = self._read_json()
            elif self.command == "POST" and resource == "export":
                if self._read_json():
                    raise RequestError(400, "Export takes an empty JSON object.")
            with server.lock:
                project = server.project(project_id)
                directory = server.projects_dir / project_id
                if self.command == "PUT" and resource is None:
                    if set(value) != {"title", "cues", "revision"}:
                        raise RequestError(400, "Provide title, cues and revision when saving.")
                    if type(value["revision"]) is not int or value["revision"] < 0:
                        raise RequestError(400, "Revision must be a nonnegative integer.")
                    if server.jobs.exporting(project_id):
                        raise RequestError(409, "This project is exporting; wait or cancel before editing.")
                    if value["revision"] != project["revision"]:
                        raise RequestError(409, "Project revision is stale; reload before saving.")
                    updated = update_project(project, value["title"], value["cues"], value["revision"])
                    _atomic_json(directory / "project.json", updated)
                    server.projects[project_id] = updated
                if self.command == "POST" and resource == "export":
                    job = server.start_export(project)
                if read and resource == "video":
                    marker = directory / "video-revision.json"
                    if not (directory / "video.mp4").is_file() or not marker.is_file():
                        raise RequestError(404, "Export a lyric video before downloading it.")
                    try:
                        current = json.loads(marker.read_text("utf-8"))["revision"]
                    except (ValueError, KeyError, TypeError):
                        raise RequestError(409, "Export this saved revision before downloading video.") from None
                    if current != project["revision"]:
                        raise RequestError(409, "Saved lyrics changed; export again before downloading video.")
            # Socket writes and streaming never hold the shared state lock.
            if read and resource is None:
                self._json(project)
                return
            if self.command == "PUT" and resource is None:
                self._json(updated)
                return
            if self.command == "POST" and resource == "export":
                self._json({"job": job}, 202)
                return
            if read and stem:
                self._file(directory / _AUDIO_FILES[stem], "audio/wav")
                return
            if read and resource == "lyrics":
                self._bytes(render_srt(project).encode("utf-8"), "application/x-subrip; charset=utf-8",
                            disposition=self._attachment(project["title"], ".srt"))
                return
            if read and resource == "video":
                self._file(directory / "video.mp4", "video/mp4",
                           disposition=self._attachment(project["title"], ".mp4"))
                return
        if read and not path.startswith("/api/"):
            relative = "index.html" if path == "/" else path.lstrip("/")
            if not re.fullmatch(r"(?:assets/)?[A-Za-z0-9_.-]+", relative):
                raise RequestError(404, "Static file not found.")
            candidate = server.dist_dir / relative
            if (candidate.suffix.lower() not in {".html", ".js", ".css", ".svg", ".png", ".ico", ".woff2", ".ttf"}
                    or not candidate.resolve().is_relative_to(server.dist_dir)):
                raise RequestError(404, "Static file not found.")
            self._file(candidate, mimetypes.guess_type(candidate)[0] or "application/octet-stream")
            return
        raise RequestError(404, "Endpoint not found.")

    def _upload(self):
        server = self.server
        length = self._length(MAX_UPLOAD)
        with server.lock:
            if not server.model_ready():
                raise RequestError(503, "The separation model is unavailable. Run explicit model setup first.")
            if server.jobs.busy() or server.uploading:
                raise JobBusy("A media job is already running. Wait or cancel it first.")
            if len(server.projects) >= MAX_PROJECTS:
                raise RequestError(409, "The 20-project storage limit was reached; existing projects are preserved.")
        encoded = self.headers.get("X-Audio-Name", "Untitled clip.wav")
        if len(encoded) > 1200 or re.search(r"%(?![0-9a-fA-F]{2})", encoded):
            raise RequestError(400, "Audio name must be a URL-encoded filename.")
        try:
            name = unquote(encoded, errors="strict").replace("\\", "/").rsplit("/", 1)[-1]
        except UnicodeError:
            raise RequestError(400, "Audio name must use valid UTF-8 encoding.") from None
        title = Path(name).stem[:100].strip() or "Untitled clip"
        if "\0" in title:
            raise RequestError(400, "Audio name must not contain NUL bytes.")
        work_dir = server.work_dir / uuid.uuid4().hex
        work_dir.mkdir()
        upload = work_dir / "input.audio"
        submitted = False
        reserved = False
        try:
            with server.lock:
                if server.jobs.busy() or server.uploading:
                    raise JobBusy("A media job or upload is already running.")
                server.uploading = True
                reserved = True
            with upload.open("wb") as output:
                remaining = length
                while remaining:
                    chunk = self.rfile.read(min(remaining, 65536))
                    if not chunk:
                        raise RequestError(400, "Upload body was incomplete.")
                    output.write(chunk)
                    remaining -= len(chunk)
            with server.lock:
                if len(server.projects) >= MAX_PROJECTS:
                    raise RequestError(409, "Project storage is full; existing projects are preserved.")
                job = server.upload(title, upload, work_dir)
                submitted = True
            self._json({"job": job}, 202)
        finally:
            if reserved:
                with server.lock:
                    server.uploading = False
            if not submitted:
                shutil.rmtree(work_dir, ignore_errors=True)


def create_server(
    data_dir: Path, model_dir: Path, port: int = 8765, *,
    dist_dir: Path | None = None, font_path: Path | None = None,
    separate: Callable | None = None, export: Callable | None = None, ready: Callable | None = None,
) -> KaraokeServer:
    """Construct a loopback server; callable overrides exist for tests only.

    A fast test fixture supplies separate/export/ready here, starts
    serve_forever in a thread, and reads server_port when port=0. The production
    CLI exposes none of these overrides and always invokes the real workers.
    """
    if type(port) is not int or not 0 <= port <= 65535:
        raise ValueError("port must be an integer between 0 and 65535")
    if separate is None or ready is None:
        from .pipeline import model_ready, separate_clip
        separate = separate or separate_clip
        ready = ready or model_ready
    if export is None:
        from .video import export_video
        export = export_video
    app = Path(__file__).resolve().parents[1]
    return KaraokeServer(data_dir, model_dir, port,
                         dist_dir=dist_dir or app / "dist", font_path=font_path or app / "assets" / "DejaVuSans.ttf",
                         separate=separate, export=export, ready=ready)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run Karaoke Studio locally; models are never downloaded at startup.")
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args(argv)
    server = create_server(args.data_dir, args.model_dir, args.port)
    def terminate(_signum, _frame):
        raise KeyboardInterrupt

    previous = signal.signal(signal.SIGTERM, terminate)
    try:
        print(f"Karaoke Studio: http://127.0.0.1:{server.server_port}", flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        signal.signal(signal.SIGTERM, previous)
