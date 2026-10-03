"""Job completion describes the full worker and cleanup lifecycle."""
import threading
import unittest

from karaoke.jobs import JobBusy, JobManager


class JobLifecycleTests(unittest.TestCase):
    def test_terminal_status_waits_for_cleanup_and_next_job_can_start(self):
        manager = JobManager()
        cleaning, finish = threading.Event(), threading.Event()
        self.addCleanup(manager.shutdown)
        self.addCleanup(finish.set)
        def cleanup():
            cleaning.set()
            finish.wait(2)
        job = manager.start("a" * 32, "separate", lambda *_: lambda: None, cleanup)
        self.assertTrue(cleaning.wait(1))
        current = manager.get(job["id"])
        self.assertEqual(current["status"], "running")
        with self.assertRaises(JobBusy):
            manager.start("b" * 32, "separate", lambda *_: lambda: None)
        # Publication has completed; late cancellation cannot relabel a saved
        # project as cancelled while its temporary files are being cleaned up.
        self.assertEqual(manager.cancel(job["id"])["status"], "running")
        finish.set()
        manager._jobs[job["id"]].thread.join(2)
        self.assertEqual(manager.get(job["id"])["status"], "complete")
        self.assertIsNone(manager.active())
        next_job = manager.start("b" * 32, "separate", lambda *_: lambda: None)
        manager._jobs[next_job["id"]].thread.join(2)
        self.assertEqual(manager.get(next_job["id"])["status"], "complete")
