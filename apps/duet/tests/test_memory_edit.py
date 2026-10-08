import concurrent.futures
import tempfile
import threading
import unittest
from pathlib import Path

from duet.store import DomainError, Store


class MemoryEditTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.store = Store(self.root)
        self.addCleanup(self.store.close)
        created = self.store.create_room('Curated history', 'Host')
        self.room, self.host = created['roomId'], created['token']
        self.guest = self.store.join_room(self.room, created['inviteToken'], 'Guest')['token']
        self.track = 'a' * 32
        self.store.add_track(self.room, self.host, self.track, 'Original <song>', '', 12)
        self.original = self.store.add_memory(self.room, self.host, self.track, '2026-10-01',
                                               'Original café 🌓')['memories'][0]

    def edit(self, *, token=None, text='Edited <literal> café 🌓', date='2026-10-08', baseline=None):
        original = baseline or self.original
        return self.store.update_memory(self.room, token or self.host, original['id'], date, text,
                                        original['date'], original['text'])

    def failure(self, status, callback):
        with self.assertRaises(DomainError) as error:
            callback()
        self.assertEqual(error.exception.status, status)

    def test_exact_edit_retains_identity_and_restarts_with_updated_export(self):
        edited = self.edit()['memories'][0]
        self.assertEqual(edited, {**self.original, 'date': '2026-10-08',
                                 'text': 'Edited <literal> café 🌓'})
        self.assertEqual(self.store.snapshot(self.room, self.guest)['memories'], [edited])
        self.assertEqual(self.store.export_room(self.room, self.host)['memories'], [edited])
        other = Store(self.root)
        try:
            self.assertEqual(other.snapshot(self.room, self.host)['memories'], [edited])
        finally:
            other.close()

    def test_only_author_can_edit_in_either_direction(self):
        self.failure(403, lambda: self.edit(token=self.guest))
        guest_memory = self.store.add_memory(self.room, self.guest, self.track, '2026-10-02',
                                             'Guest words')['memories'][-1]
        self.failure(403, lambda: self.edit(baseline=guest_memory))
        edited = self.edit(token=self.guest, baseline=guest_memory)['memories'][-1]
        self.assertEqual(edited['text'], 'Edited <literal> café 🌓')

    def test_stale_baselines_and_missing_memories_do_not_overwrite(self):
        winner = self.edit()['memories'][0]
        self.failure(409, lambda: self.edit(text='Stale loser'))
        self.assertEqual(self.store.snapshot(self.room, self.host)['memories'], [winner])
        self.store.delete_memory(self.room, self.host, winner['id'])
        self.failure(404, lambda: self.edit(baseline=winner))

    def test_invalid_fields_are_atomic_and_raw_unicode_is_preserved(self):
        for text, date in [('', '2026-10-08'), ('x' * 501, '2026-10-08'),
                           ('bad\0', '2026-10-08'), ('\ud800', '2026-10-08'),
                           ('Valid', '2026-02-30'), ('Valid', '1899-12-31')]:
            self.failure(400, lambda: self.edit(text=text, date=date))
        self.assertEqual(self.store.snapshot(self.room, self.host)['memories'], [self.original])
        self.assertEqual(self.edit(text='  Literal\n<kept> 😀  ')['memories'][0]['text'],
                         '  Literal\n<kept> 😀  ')

    def test_removed_audio_does_not_prevent_correction(self):
        self.store.delete_track(self.room, self.host, self.track)
        edited = self.edit()['memories'][0]
        self.assertEqual(edited['trackId'], self.track)
        self.assertEqual(edited['trackTitle'], self.original['trackTitle'])

    def test_two_connections_have_one_compare_and_swap_winner(self):
        other = Store(self.root)
        self.addCleanup(other.close)
        barrier = threading.Barrier(2)

        def update(store, text):
            barrier.wait()
            try:
                store.update_memory(self.room, self.host, self.original['id'], '2026-10-08', text,
                                    self.original['date'], self.original['text'])
                return 200
            except DomainError as error:
                return error.status

        with concurrent.futures.ThreadPoolExecutor(2) as executor:
            first = executor.submit(update, self.store, 'First authored edit')
            second = executor.submit(update, other, 'Second authored edit')
            self.assertEqual(sorted([first.result(), second.result()]), [200, 409])
        self.assertIn(self.store.snapshot(self.room, self.host)['memories'][0]['text'],
                      ['First authored edit', 'Second authored edit'])
