from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest

from challenges.store import Store, DomainError
from challenges import domain


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='challenge-store-')
        self.path = Path(self.directory.name)
        self.time = 1900000000.0
        self.store = Store(self.path, clock=lambda: self.time)
        self.connections = [self.store]

    def tearDown(self):
        for store in self.connections:
            store.close()
        self.directory.cleanup()

    def terms(self, **patch):
        return dict(title='Read together', description='Read our selected book.',
                    successCriteria='Finish and compare notes', evidenceRule='Text notes',
                    stake='pick-a-movie', deadline=int(self.time * 1000) + 10000, **patch)

    def create(self):
        return self.store.create({'name': 'Alex', 'terms': self.terms()})

    def pair(self, active=True):
        created = self.create()
        joined = self.store.join(created['challengeId'], {'inviteToken': created['inviteToken'], 'name': 'Sam'})
        if active:
            self.cmd(created, joined['token'], 'accept', termsVersion=1)
        return created, joined

    def cmd(self, created, token, action, **payload):
        current = self.store.get(created['challengeId'], token)
        return self.store.command(created['challengeId'], token, action, {'revision': current['revision'], **payload})

    def error(self, code, call):
        with self.assertRaises(DomainError) as caught:
            call()
        self.assertEqual(caught.exception.code, code)
        return caught.exception

    def dispute(self):
        created, joined = self.pair()
        result = self.cmd(created, created['token'], 'result', outcome='proposer', reason='My supplied result')
        self.cmd(created, joined['token'], 'result/respond', proposalId=result['resultProposal']['id'], accept=False, reason='I disagree')
        return created, joined

    def nominated(self):
        created, joined = self.dispute()
        current = self.cmd(created, created['token'], 'arbiter/nominate', name='Robin', reason='Trusted by both')
        nomination = current['arbiterNomination']['id']
        self.cmd(created, joined['token'], 'arbiter/respond', nominationId=nomination, accept=True, reason='')
        invite = self.cmd(created, created['token'], 'invite', seat='arbiter')
        return created, joined, nomination, invite

    def second_store(self):
        store = Store(self.path, clock=lambda: self.time)
        self.connections.append(store)
        return store

    def race(self, first, second):
        barrier = threading.Barrier(2)

        def run(call):
            barrier.wait()
            try:
                return ('ok', call())
            except DomainError as error:
                return (error.code, None)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(run, call) for call in (first, second)]
            return [future.result() for future in futures]

    def test_creation_tokens_hashes_and_snapshot_copies(self):
        created = self.create()
        token = created['token']
        invite = created['inviteToken']
        self.assertNotEqual(token, invite)
        self.assertEqual(len(token), 64)
        self.assertEqual(created['challenge']['revision'], 1)
        self.assertEqual(created['challenge']['events'][0]['seq'], 1)
        created['challenge']['terms']['title'] = 'Changed locally'
        snapshot = self.store.get(created['challengeId'], token)
        self.assertEqual(snapshot['terms']['title'], 'Read together')
        raw = (self.path / 'challenges.sqlite3').read_bytes()
        self.assertNotIn(token.encode(), raw)
        self.assertNotIn(invite.encode(), raw)
        self.assertIn(hashlib.sha256(token.encode()).hexdigest().encode(), raw)
        public = json.dumps(snapshot)
        for secret in (token, invite, hashlib.sha256(token.encode()).hexdigest()):
            self.assertNotIn(secret, public)

    def test_corrupt_audit_cannot_claim_arbiter_without_live_invitation(self):
        for previously_withdrawn in (False, True):
            with self.subTest(previously_withdrawn=previously_withdrawn):
                if previously_withdrawn:
                    created, joined, nomination, _ = self.nominated()
                    self.cmd(created, created['token'], 'arbiter/withdraw', nominationId=nomination, reason='Choose again')
                else:
                    created, joined = self.dispute()
                current = self.cmd(created, created['token'], 'arbiter/nominate', name='Robin', reason='Agreed person')
                self.cmd(created, joined['token'], 'arbiter/respond', nominationId=current['arbiterNomination']['id'], accept=True, reason='')
                with sqlite3.connect(self.path / 'challenges.sqlite3') as connection:
                    record = json.loads(connection.execute('SELECT record FROM challenges WHERE id=?', (created['challengeId'],)).fetchone()[0])
                    domain.apply_claim(record['state'], 'arbiter', 'Robin', int(self.time * 1000))
                    record['hashes']['arbiter'] = 'a' * 64
                    raw = json.dumps(record)
                    connection.execute('UPDATE challenges SET record=? WHERE id=?', (raw, created['challengeId']))
                self.error('internal_error', lambda: self.store.get(created['challengeId'], created['token']))
                self.error('internal_error', lambda: Store(self.path, clock=lambda: self.time))
                with sqlite3.connect(self.path / 'challenges.sqlite3') as connection:
                    self.assertEqual(connection.execute('SELECT record FROM challenges WHERE id=?', (created['challengeId'],)).fetchone()[0], raw)
                    # Remove only the injected fixture so the second independent case can proceed.
                    connection.execute('DELETE FROM challenges WHERE id=?', (created['challengeId'],))

    def test_oversized_corrupt_record_is_rejected_before_python_materialization(self):
        created = self.create()
        with sqlite3.connect(self.path / 'challenges.sqlite3') as connection:
            connection.execute('UPDATE challenges SET record=? WHERE id=?', ('x' * (domain.MAX_BYTES + 1), created['challengeId']))
        decoded_lengths = []

        def decode(raw):
            decoded_lengths.append(len(raw))
            return raw.decode('utf-8')

        self.store._connection.text_factory = decode
        self.error('internal_error', lambda: self.store.get(created['challengeId'], created['token']))
        self.assertTrue(all(length <= domain.MAX_BYTES for length in decoded_lengths))

    def test_direct_inputs_and_capability_types_cannot_bypass_validation(self):
        created = self.create()
        self.error('invalid_request', lambda: self.store.create({'name': 'Alex', 'terms': self.terms(), 'token': 'x'}))
        self.error('unauthorized', lambda: self.store.get(created['challengeId'], created['inviteToken']))
        self.error('unauthorized', lambda: self.store.get('f' * 32, created['token']))
        other = self.create()
        self.error('unauthorized', lambda: self.store.get(other['challengeId'], created['token']))
        self.error('not_found', lambda: self.store.join(created['challengeId'], {'inviteToken': created['token'], 'name': 'Sam'}))
        self.error('invalid_request', lambda: self.cmd(created, created['token'], 'unknown'))
        self.error('invalid_request', lambda: self.cmd(created, created['token'], 'withdraw', reason='x', extra=True))

    def test_two_connection_invitation_claim_has_exactly_one_winner(self):
        created = self.create()
        second = self.second_store()
        payload = {'inviteToken': created['inviteToken'], 'name': 'Sam'}
        results = self.race(lambda: self.store.join(created['challengeId'], payload), lambda: second.join(created['challengeId'], payload))
        self.assertEqual(sorted(value[0] for value in results), ['not_found', 'ok'])
        snapshot = self.store.get(created['challengeId'], created['token'])
        self.assertEqual(snapshot['revision'], 2)
        self.assertEqual(snapshot['status'], 'proposed')
        self.assertIsNone(snapshot['acceptedAt'])

    def test_terms_acceptance_is_exact_and_accepted_terms_are_frozen(self):
        created, joined = self.pair(False)
        old = joined['challenge']
        changed = self.cmd(created, created['token'], 'terms', terms={**self.terms(), 'title': 'Updated terms'})
        self.error('conflict', lambda: self.store.command(created['challengeId'], joined['token'], 'accept', {'revision': old['revision'], 'termsVersion': 1}))
        self.error('conflict', lambda: self.cmd(created, joined['token'], 'accept', termsVersion=1))
        self.error('forbidden', lambda: self.cmd(created, created['token'], 'accept', termsVersion=2))
        accepted = self.cmd(created, joined['token'], 'accept', termsVersion=changed['termsVersion'])
        self.assertEqual(accepted['status'], 'active')
        self.error('conflict', lambda: self.cmd(created, created['token'], 'terms', terms=self.terms()))
        self.assertEqual(self.store.get(created['challengeId'], created['token'])['terms'], accepted['terms'])

    def test_deadline_equality_closes_acceptance_but_never_invents_outcomes(self):
        created, joined = self.pair(False)
        self.time += 10
        snapshot = self.store.get(created['challengeId'], joined['token'])
        self.assertTrue(snapshot['deadlinePassed'])
        self.assertEqual(snapshot['status'], 'proposed')
        self.assertEqual(snapshot['revision'], joined['challenge']['revision'])
        self.error('conflict', lambda: self.cmd(created, joined['token'], 'accept', termsVersion=1))
        self.assertIsNone(self.store.get(created['challengeId'], joined['token'])['resolution'])

    def test_evidence_is_append_only_and_lateness_uses_captured_server_time(self):
        created, joined = self.pair()
        deadline = created['challenge']['terms']['deadline']
        for millis in (deadline - 1, deadline, deadline + 1):
            self.time = millis / 1000
            self.cmd(created, joined['token'], 'evidence', text='A <script>literal</script> correction', url='https://example.com/note#part')
        current = self.store.get(created['challengeId'], created['token'])
        self.assertEqual([item['late'] for item in current['evidence']], [False, True, True])
        self.assertEqual([item['createdAt'] for item in current['evidence']], [deadline - 1, deadline, deadline + 1])
        self.assertTrue(all(item['author'] == 'opponent' for item in current['evidence']))
        self.error('invalid_request', lambda: self.cmd(created, joined['token'], 'evidence/delete', id=current['evidence'][0]['id']))
        self.assertEqual(self.store.get(created['challengeId'], created['token'])['evidence'], current['evidence'])

    def test_result_self_confirmation_and_obsolete_ids_fail_without_events(self):
        created, joined = self.pair()
        proposal = self.cmd(created, created['token'], 'result', outcome='proposer', reason='Recorded claim')['resultProposal']
        before = self.store.get(created['challengeId'], created['token'])
        self.error('forbidden', lambda: self.cmd(created, created['token'], 'result/respond', proposalId=proposal['id'], accept=True, reason=''))
        self.error('conflict', lambda: self.cmd(created, joined['token'], 'result/respond', proposalId='f' * 32, accept=True, reason=''))
        self.assertEqual(self.store.get(created['challengeId'], created['token']), before)
        result = self.cmd(created, joined['token'], 'result/respond', proposalId=proposal['id'], accept=True, reason='')
        self.assertEqual(result['status'], 'resolved')
        self.assertIsNone(result['resultProposal'])
        self.assertEqual(result['resolution']['reason'], 'Recorded claim')
        self.assertEqual(result['resolution']['by'], 'opponent')
        self.error('conflict', lambda: self.cmd(created, joined['token'], 'evidence', text='Late rewrite', url=None))
        self.assertEqual(self.store.get(created['challengeId'], joined['token'])['revision'], result['revision'])

    def test_competing_mutual_result_and_void_settle_only_once(self):
        created, joined = self.pair()
        proposal = self.cmd(created, created['token'], 'result', outcome='proposer', reason='Claim')['resultProposal']
        offer = self.cmd(created, created['token'], 'void', reason='Keep it friendly')['voidProposal']
        second = self.second_store()
        revision = self.store.get(created['challengeId'], joined['token'])['revision']
        results = self.race(
            lambda: self.store.command(created['challengeId'], joined['token'], 'result/respond', {'revision': revision, 'proposalId': proposal['id'], 'accept': True, 'reason': ''}),
            lambda: second.command(created['challengeId'], joined['token'], 'void/confirm', {'revision': revision, 'proposalId': offer['id']}))
        self.assertEqual(sorted(value[0] for value in results), ['conflict', 'ok'])
        result = self.store.get(created['challengeId'], created['token'])
        self.assertEqual(result['revision'], revision + 1)
        self.assertIn(result['status'], ['resolved', 'voided'])

    def test_arbiter_requires_mutual_same_nomination_and_correct_unclaimed_invite(self):
        created, joined = self.dispute()
        nomination = self.cmd(created, created['token'], 'arbiter/nominate', name='Robin', reason='Trusted')['arbiterNomination']
        self.error('conflict', lambda: self.cmd(created, created['token'], 'invite', seat='arbiter'))
        self.error('forbidden', lambda: self.cmd(created, created['token'], 'arbiter/respond', nominationId=nomination['id'], accept=True, reason=''))
        self.cmd(created, joined['token'], 'arbiter/respond', nominationId=nomination['id'], accept=True, reason='')
        invite = self.cmd(created, joined['token'], 'invite', seat='arbiter')
        self.error('invalid_request', lambda: self.store.join_arbiter(created['challengeId'], {'inviteToken': invite['inviteToken'], 'name': 'Wrong'}))
        arbiter = self.store.join_arbiter(created['challengeId'], {'inviteToken': invite['inviteToken'], 'name': '  Robin  '})
        self.assertEqual(arbiter['challenge']['myRole'], 'arbiter')
        self.error('not_found', lambda: self.store.join_arbiter(created['challengeId'], {'inviteToken': invite['inviteToken'], 'name': 'Robin'}))
        self.error('forbidden', lambda: self.cmd(created, arbiter['token'], 'evidence', text='My participant evidence', url=None))
        self.error('forbidden', lambda: self.cmd(created, joined['token'], 'arbiter/decide', outcome='opponent', reason='Impersonation'))
        self.error('conflict', lambda: self.cmd(created, joined['token'], 'arbiter/withdraw', nominationId=nomination['id'], reason='Shopping'))
        result = self.cmd(created, arbiter['token'], 'arbiter/decide', outcome='void', reason='Insufficient agreement')
        self.assertEqual(result['status'], 'voided')
        self.assertEqual(result['resolution']['method'], 'arbiter')

    def test_withdrawn_and_reissued_invitations_are_invalidated(self):
        created = self.create()
        new = self.cmd(created, created['token'], 'invite', seat='opponent')
        self.error('not_found', lambda: self.store.join(created['challengeId'], {'inviteToken': created['inviteToken'], 'name': 'Sam'}))
        self.store.join(created['challengeId'], {'inviteToken': new['inviteToken'], 'name': 'Sam'})
        created, joined, nomination, invite = self.nominated()
        newer = self.cmd(created, joined['token'], 'invite', seat='arbiter')
        self.error('not_found', lambda: self.store.join_arbiter(created['challengeId'], {'inviteToken': invite['inviteToken'], 'name': 'Robin'}))
        self.cmd(created, joined['token'], 'arbiter/withdraw', nominationId=nomination, reason='Changed our minds')
        self.error('not_found', lambda: self.store.join_arbiter(created['challengeId'], {'inviteToken': newer['inviteToken'], 'name': 'Robin'}))

    def test_withdrawal_versus_arbiter_claim_race_has_one_serialized_winner(self):
        created, joined, nomination, invite = self.nominated()
        second = self.second_store()
        revision = invite['challenge']['revision']
        results = self.race(
            lambda: self.store.command(created['challengeId'], joined['token'], 'arbiter/withdraw', {'revision': revision, 'nominationId': nomination, 'reason': 'Withdraw'}),
            lambda: second.join_arbiter(created['challengeId'], {'inviteToken': invite['inviteToken'], 'name': 'Robin'}))
        self.assertEqual(sum(result[0] == 'ok' for result in results), 1)
        self.assertTrue(any(result[0] in ('conflict', 'not_found') for result in results))

    def test_terminal_transitions_invalidate_unclaimed_invites_and_keep_read_access(self):
        for action in ('decline', 'withdraw'):
            created, joined = self.pair(False)
            token = joined['token'] if action == 'decline' else created['token']
            current = self.cmd(created, token, action, reason='Not this time')
            self.assertIn(current['status'], ['declined', 'withdrawn'])
            self.assertIsNone(current['resolution'])
            self.assertEqual(self.store.get(created['challengeId'], created['token'])['revision'], current['revision'])
        created = self.create()
        self.cmd(created, created['token'], 'withdraw', reason='Cancelled')
        self.error('not_found', lambda: self.store.join(created['challengeId'], {'inviteToken': created['inviteToken'], 'name': 'Sam'}))

    def test_quota_exhaustion_preserves_irrevocable_mutual_void_exit(self):
        created, joined = self.pair()
        for _ in range(40):
            self.cmd(created, created['token'], 'evidence', text='Recorded evidence', url=None)
        self.error('limit', lambda: self.cmd(created, joined['token'], 'evidence', text='Extra', url=None))
        for _ in range(10):
            result = self.cmd(created, created['token'], 'result', outcome='proposer', reason='Claim')
            self.cmd(created, joined['token'], 'result/respond', proposalId=result['resultProposal']['id'], accept=False, reason='Disagree')
        self.error('limit', lambda: self.cmd(created, created['token'], 'result', outcome='proposer', reason='Extra'))
        for _ in range(5):
            nomination = self.cmd(created, created['token'], 'arbiter/nominate', name='Robin', reason='Nomination')['arbiterNomination']
            self.cmd(created, joined['token'], 'arbiter/respond', nominationId=nomination['id'], accept=False, reason='Disagree')
        self.error('limit', lambda: self.cmd(created, created['token'], 'arbiter/nominate', name='Robin', reason='Extra'))
        offer = self.cmd(created, joined['token'], 'void', reason='Agreed to leave open')['voidProposal']
        self.error('conflict', lambda: self.cmd(created, joined['token'], 'void', reason='Replace my consent'))
        self.error('forbidden', lambda: self.cmd(created, joined['token'], 'void/confirm', proposalId=offer['id']))
        final = self.cmd(created, created['token'], 'void/confirm', proposalId=offer['id'])
        self.assertEqual(final['status'], 'voided')
        self.assertLess(final['revision'], 128)

    def test_edit_and_invite_quotas_do_not_prevent_acceptance(self):
        created = self.create()
        for _ in range(10):
            self.cmd(created, created['token'], 'terms', terms=self.terms())
        self.error('limit', lambda: self.cmd(created, created['token'], 'terms', terms=self.terms()))
        for _ in range(9):
            invitation = self.cmd(created, created['token'], 'invite', seat='opponent')
        self.error('limit', lambda: self.cmd(created, created['token'], 'invite', seat='opponent'))
        joined = self.store.join(created['challengeId'], {'inviteToken': invitation['inviteToken'], 'name': 'Sam'})
        self.assertEqual(self.cmd(created, joined['token'], 'accept', termsVersion=11)['status'], 'active')

    def test_reopen_preserves_events_capabilities_and_token_free_export(self):
        created, joined = self.pair()
        self.cmd(created, joined['token'], 'evidence', text='Persistent', url=None)
        before = self.store.get(created['challengeId'], joined['token'])
        self.store.close()
        self.store = self.second_store()
        self.assertEqual(self.store.get(created['challengeId'], joined['token']), before)
        exported = self.store.export(created['challengeId'], joined['token'])
        self.assertEqual(exported['schemaVersion'], 1)
        self.assertNotIn('myRole', exported['challenge'])
        self.assertNotIn('serverTime', exported['challenge'])
        public = json.dumps(exported)
        for token in (created['token'], created['inviteToken'], joined['token']):
            self.assertNotIn(token, public)
            self.assertNotIn(hashlib.sha256(token.encode()).hexdigest(), public)
        self.assertEqual(exported['challenge']['events'], before['events'])

    def test_database_failure_rolls_back_event_and_revision(self):
        created, joined = self.pair()
        before = self.store.get(created['challengeId'], joined['token'])
        with sqlite3.connect(self.path / 'challenges.sqlite3') as connection:
            connection.execute("CREATE TRIGGER refuse_update BEFORE UPDATE ON challenges BEGIN SELECT RAISE(ABORT, 'private trigger content'); END")
        error = self.error('internal_error', lambda: self.cmd(created, joined['token'], 'evidence', text='Not published', url=None))
        self.assertNotIn('private trigger', str(error))
        self.assertEqual(self.store.get(created['challengeId'], joined['token']), before)

    def test_stored_audit_corruption_is_rejected_on_reads_and_reopen_without_rewriting(self):
        created, joined = self.pair()
        with sqlite3.connect(self.path / 'challenges.sqlite3') as connection:
            row = connection.execute('SELECT record FROM challenges WHERE id=?', (created['challengeId'],)).fetchone()[0]
            record = json.loads(row)
            record['state']['terms']['title'] = 'Tampered accepted terms'
            corrupted = json.dumps(record)
            connection.execute('UPDATE challenges SET record=? WHERE id=?', (corrupted, created['challengeId']))
        self.error('internal_error', lambda: self.store.get(created['challengeId'], joined['token']))
        self.store.close()
        with self.assertRaises(DomainError):
            Store(self.path, clock=lambda: self.time)
        with sqlite3.connect(self.path / 'challenges.sqlite3') as connection:
            self.assertEqual(connection.execute('SELECT record FROM challenges').fetchone()[0], corrupted)

    def test_total_challenge_quota_is_durable_and_closed_store_rejects_cleanly(self):
        for _ in range(20):
            self.create()
        self.error('limit', self.create)
        self.store.close()
        self.store.close()
        with self.assertRaises(RuntimeError):
            self.create()

    def test_invalid_revision_boolean_and_failed_inputs_are_atomic(self):
        created, joined = self.pair()
        before = deepcopy(self.store.get(created['challengeId'], joined['token']))
        for patch in ({'revision': True}, {'revision': 1.0}, {'revision': -1}, {'text': '\ud800'}, {'text': 'x' * 1001}, {'url': 'https://127.1/'}):
            payload = {'revision': before['revision'], 'text': 'Evidence', 'url': None, **patch}
            self.error('invalid_request', lambda: self.store.command(created['challengeId'], joined['token'], 'evidence', payload))
        self.assertEqual(self.store.get(created['challengeId'], joined['token']), before)


if __name__ == '__main__':
    unittest.main()
