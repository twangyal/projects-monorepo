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


class ArchiveJobTests(unittest.TestCase):
    def test_archive_kinds_share_worker_and_export_edit_protection(self):
        for kind in ('archive-export', 'archive-import'):
            with self.subTest(kind=kind):
                manager = JobManager()
                ready, finish = threading.Event(), threading.Event()
                def work(cancel, stage):
                    ready.set()
                    finish.wait(2)
                    return lambda: '/api/projects/' + 'a' * 32
                try:
                    job = manager.start('a' * 32, kind, work)
                    self.assertTrue(ready.wait(1))
                    self.assertEqual(manager.exporting('a' * 32), kind == 'archive-export')
                    with self.assertRaises(JobBusy):
                        manager.start('b' * 32, 'export', lambda *_: lambda: None)
                    manager.cancel(job['id'])
                    finish.set()
                    manager._jobs[job['id']].thread.join(2)
                    self.assertEqual(manager.get(job['id'])['status'], 'cancelled')
                    self.assertNotIn('resultUrl', manager.get(job['id']))
                finally:
                    finish.set()
                    manager.shutdown()


class RetainedUploadTests(unittest.TestCase):
    def test_explicit_complete_upload_can_publish_after_cancellation(self):
        from karaoke.jobs import JobPublication
        manager = JobManager()
        ready, finish = threading.Event(), threading.Event()
        published = []
        self.addCleanup(manager.shutdown)
        self.addCleanup(finish.set)
        def work(cancel, stage):
            ready.set()
            finish.wait(2)
            return JobPublication(lambda: published.append('stems'), retain_on_cancel=True)
        job = manager.start('a' * 32, 'separate', work)
        self.assertTrue(ready.wait(1))
        manager.cancel(job['id'])
        finish.set()
        manager._jobs[job['id']].thread.join(2)
        self.assertEqual(published, ['stems'])
        self.assertEqual(manager.get(job['id'])['status'], 'complete')
        self.assertTrue(manager.get(job['id'])['retainedOnCancel'])
        self.assertIsNone(manager.active())

    def test_retained_publication_failure_is_reported_even_with_cancellation(self):
        from karaoke.jobs import JobPublication
        manager = JobManager()
        ready, finish = threading.Event(), threading.Event()
        self.addCleanup(manager.shutdown)
        self.addCleanup(finish.set)
        def publish():
            raise RuntimeError('Storage refused completed stems.')
        def work(cancel, stage):
            ready.set()
            finish.wait(2)
            return JobPublication(publish, retain_on_cancel=True)
        job = manager.start('a' * 32, 'separate', work)
        self.assertTrue(ready.wait(1))
        manager.cancel(job['id'])
        finish.set()
        manager._jobs[job['id']].thread.join(2)
        done = manager.get(job['id'])
        self.assertEqual(done['status'], 'failed')
        self.assertIn('Storage refused', done['error'])
        self.assertNotIn('retainedOnCancel', done)
