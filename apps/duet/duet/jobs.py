"""One cancellable upload slot; retained records contain no capabilities."""

from collections import OrderedDict
from dataclasses import dataclass, field
import threading
import uuid

from .store import DomainError


@dataclass
class _Job:
    id: str
    room_id: str
    track_id: str
    uploaded_by: str
    status: str = 'running'
    stage: str = 'Receiving upload'
    error: str | None = None
    cancel: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None
    interrupt: object = None
    published: bool = False

    def snapshot(self):
        result = dict(id=self.id, roomId=self.room_id, trackId=self.track_id,
                      uploadedBy=self.uploaded_by, status=self.status, stage=self.stage)
        if self.error:
            result['error'] = self.error
        return result


class JobManager:
    def __init__(self, lock=None):
        self.lock = lock or threading.RLock()
        self.records = OrderedDict()
        self.active_id = None
        self.closed = False

    def reserve(self, room_id, track_id, role, interrupt):
        with self.lock:
            if self.closed or self.active_id:
                raise DomainError(409, 'Another upload is active. Wait for it or cancel it first.')
            job = _Job(uuid.uuid4().hex, room_id, track_id, role,
                       thread=threading.current_thread(), interrupt=interrupt)
            self.records[job.id] = job
            self.active_id = job.id
            while len(self.records) > 50:
                self.records.popitem(last=False)
            return job

    def _get(self, room_id, job_id):
        job = self.records.get(job_id)
        if job is None or job.room_id != room_id:
            raise DomainError(404, 'Upload job not found in this room.')
        return job

    def get(self, room_id, job_id):
        with self.lock:
            return self._get(room_id, job_id).snapshot()

    def active(self, room_id):
        with self.lock:
            job = self.records.get(self.active_id)
            return job.snapshot() if job and job.room_id == room_id else None

    def cancel_job(self, room_id, job_id, role):
        with self.lock:
            job = self._get(room_id, job_id)
            if role != 'host' and role != job.uploaded_by:
                raise DomainError(403, 'Only the uploader or host can cancel this upload.')
            interrupt = None
            if job.status == 'running' and not job.published:
                job.cancel.set()
                job.stage = 'Cancelling'
                interrupt = job.interrupt
            result = job.snapshot()
        if interrupt:
            interrupt()
        return result

    def finish_receiving(self, job, error=None):
        with self.lock:
            job.status = 'cancelled' if job.cancel.is_set() else 'failed'
            job.stage = 'Cancelled' if job.cancel.is_set() else 'Failed'
            job.error = None if job.cancel.is_set() else error
            job.interrupt = None
            job.thread = None
            self.active_id = None

    def begin(self, job, work, cleanup):
        def stage(message):
            with self.lock:
                if not job.cancel.is_set():
                    job.stage = str(message)[:120]

        def run():
            status, error = 'failed', 'Audio processing failed. Check the file and try again.'
            try:
                if job.cancel.is_set():
                    raise RuntimeError('Cancelled')
                publish = work(job.cancel, stage)
                with self.lock:
                    if job.cancel.is_set():
                        raise RuntimeError('Cancelled')
                    publish()
                    job.published = True
                    status, error = 'complete', None
            except Exception:
                if job.cancel.is_set():
                    status, error = 'cancelled', None
            finally:
                try:
                    cleanup()
                finally:
                    with self.lock:
                        job.status, job.error = status, error
                        job.stage = {'complete': 'Complete', 'failed': 'Failed', 'cancelled': 'Cancelled'}[status]
                        job.thread = None
                        self.active_id = None

        with self.lock:
            if self.closed or job.cancel.is_set():
                raise DomainError(409, 'Upload cancelled.')
            job.interrupt = None
            job.stage = 'Processing audio'
            job.thread = threading.Thread(target=run, name='duet-media-job', daemon=True)
            job.thread.start()

    def close(self):
        with self.lock:
            self.closed = True
            job = self.records.get(self.active_id)
            interrupt, thread = None, None
            if job:
                if not job.published:
                    job.cancel.set()
                    interrupt = job.interrupt
                thread = job.thread
        if interrupt:
            interrupt()
        if thread and thread is not threading.current_thread():
            thread.join(50)
            if thread.is_alive():
                raise RuntimeError('The active upload did not stop; its data directory remains locked.')
