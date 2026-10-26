"""One cancellable media worker and a bounded history of job snapshots."""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
import threading
import uuid


class JobBusy(RuntimeError):
    """The single media worker is already occupied or shutting down."""


@dataclass(frozen=True)
class JobPublication:
    """A completed upload may retain its usable stems after recognition cancellation."""

    publish: Callable[[], str | None]
    retain_on_cancel: bool = False


@dataclass
class _Job:
    id: str
    project_id: str
    kind: str
    status: str = "running"
    stage: str = "Starting"
    error: str | None = None
    result_url: str | None = None
    finalizing: bool = False
    retained_on_cancel: bool = False
    cancel: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None

    def snapshot(self) -> dict:
        value = dict(id=self.id, projectId=self.project_id, kind=self.kind,
                     status=self.status, stage=self.stage)
        if self.error:
            value["error"] = self.error
        if self.result_url:
            value["resultUrl"] = self.result_url
        if self.retained_on_cancel:
            value["retainedOnCancel"] = True
        return value


class JobManager:
    """Serialize media work and publish successful results under one lock.

    A worker returns a publication callback instead of publishing directly.
    The cancellation check, callback and completed status occur under the same
    lock, preventing cancellation from racing publication. A completed upload may
    explicitly retain usable stems after its optional recognition was cancelled.
    """

    def __init__(self, lock: threading.RLock | None = None, max_records: int = 50):
        if type(max_records) is not int or max_records < 1:
            raise ValueError("max_records must be a positive integer")
        self.lock = lock or threading.RLock()
        self.max_records = max_records
        self._jobs: OrderedDict[str, _Job] = OrderedDict()
        self._active: _Job | None = None
        self._closed = False

    def busy(self) -> bool:
        with self.lock:
            return self._closed or self._active is not None

    def exporting(self, project_id: str) -> bool:
        with self.lock:
            return bool(self._active and self._active.kind in {"export", "archive-export"}
                        and self._active.project_id == project_id)

    def get(self, job_id: str) -> dict:
        with self.lock:
            return self._jobs[job_id].snapshot()

    def active(self) -> dict | None:
        with self.lock:
            return self._active.snapshot() if self._active else None

    def cancel(self, job_id: str) -> dict:
        with self.lock:
            job = self._jobs[job_id]
            if job.status == "running" and not job.finalizing:
                job.cancel.set()
                job.stage = "Cancelling"
            return job.snapshot()

    def start(
        self, project_id: str, kind: str,
        work: Callable[[threading.Event, Callable[[str], None]], Callable[[], str | None] | JobPublication],
        cleanup: Callable[[], None] | None = None,
    ) -> dict:
        if kind not in {"separate", "export", "archive-export", "archive-import", "transcribe"}:
            raise ValueError("Unknown media job kind")
        with self.lock:
            if self.busy():
                raise JobBusy("A media job is already running. Wait or cancel it first.")
            while len(self._jobs) >= self.max_records:
                self._jobs.popitem(last=False)
            job = _Job(uuid.uuid4().hex, project_id, kind)
            self._jobs[job.id] = job
            self._active = job

            def stage(message: str):
                with self.lock:
                    if job.status == "running" and not job.cancel.is_set():
                        job.stage = str(message)[:200]

            def run():
                outcome, final_stage = "failed", "Failed"
                publishing = False
                try:
                    result = work(job.cancel, stage)
                    publication = result if isinstance(result, JobPublication) else JobPublication(result)
                    if publication.retain_on_cancel and kind != 'separate':
                        raise ValueError('Only a completed upload may be retained on cancellation.')
                    with self.lock:
                        cancelled = job.cancel.is_set()
                        if cancelled and not publication.retain_on_cancel:
                            outcome, final_stage = "cancelled", "Cancelled"
                        else:
                            publishing = True
                            job.result_url = publication.publish()
                            job.retained_on_cancel = cancelled
                            outcome, final_stage = "complete", "Complete"
                            if cancelled:
                                final_stage = 'Stems saved; recognition cancelled'
                        job.finalizing, job.stage = True, "Cleaning up"
                except Exception as error:
                    with self.lock:
                        if job.cancel.is_set() and not publishing:
                            outcome, final_stage = "cancelled", "Cancelled"
                        else:
                            job.error = str(error)[:500] or "Media processing failed."
                        job.finalizing, job.stage = True, "Cleaning up"
                finally:
                    try:
                        if cleanup:
                            cleanup()
                    finally:
                        with self.lock:
                            job.status, job.stage = outcome, final_stage
                            self._active = None

            job.thread = threading.Thread(target=run, name=f"karaoke-{kind}-{job.id}", daemon=True)
            job.thread.start()
            return job.snapshot()

    def shutdown(self):
        with self.lock:
            self._closed = True
            if self._active:
                self._active.cancel.set()
                self._active.stage = "Cancelling"
            threads = [job.thread for job in self._jobs.values() if job.thread]
        for thread in threads:
            if thread is not threading.current_thread():
                thread.join(timeout=30)
