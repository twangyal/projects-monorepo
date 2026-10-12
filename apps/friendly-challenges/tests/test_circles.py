"""Friend circles: membership, dual-consent sharing, the derived feed, reactions and privacy."""

import http.client
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import threading
import unittest

from challenges.circles import feed_items
from challenges.server import create_server


class CircleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dist = self.root / 'dist'
        self.dist.mkdir()
        (self.dist / 'index.html').write_text('<h1>Friendly Challenges</h1>')
        self.now = 1900000000.0
        self.data = self.root / 'data'
        self.server = create_server(self.data, 0, dist_dir=self.dist, now=lambda: self.now)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()

        def stop():
            self.server.shutdown()
            self.server.server_close()
            thread.join(3)
        self.addCleanup(stop)
        terms = dict(title='Finish the 10K', description='Run the city route', successCriteria='Cross the line under an hour',
                     evidenceRule='Finish photo or time', stake='do-the-dishes', deadline=int(self.now * 1000) + 86400000)
        status, created = self.request('POST', '/api/challenges', {'name': 'Joe', 'terms': terms})
        self.assertEqual(status, 201, created)
        self.challenge, self.joe_seat = created['challengeId'], created['token']
        self.endpoint = f'/api/challenges/{self.challenge}'
        status, claim = self.request('POST', self.endpoint + '/join', {'inviteToken': created['inviteToken'], 'name': 'Terry'})
        self.terry_seat = claim['token']

    def request(self, method, path, body=None, token=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        headers = {}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers['Content-Type'] = 'application/json'
        try:
            connection.request(method, path, body=data, headers=headers)
            response = connection.getresponse()
            contents = response.read()
            return response.status, json.loads(contents) if contents else None
        finally:
            connection.close()

    def command(self, action, token, **body):
        body.setdefault('revision', self.request('GET', self.endpoint, token=self.joe_seat)[1]['revision'])
        status, value = self.request('POST', f'{self.endpoint}/{action}', body, token)
        self.assertEqual(status, 200, value)
        return value

    def circle(self):
        status, created = self.request('POST', '/api/circles', {'circleName': 'Running club', 'name': 'Joe'})
        self.assertEqual(status, 201, created)
        circle_id, joe = created['circleId'], created['token']
        status, joined = self.request('POST', f'/api/circles/{circle_id}/join', {'inviteToken': created['inviteToken'], 'name': 'Terry'})
        self.assertEqual(status, 200, joined)
        status, sam = self.request('POST', f'/api/circles/{circle_id}/join', {'inviteToken': created['inviteToken'], 'name': 'Sam'})
        return circle_id, joe, joined['token'], sam['token']

    def test_storage_is_owner_only_and_backups_ignore_it(self):
        self.circle()
        self.assertEqual(stat.S_IMODE(os.stat(self.data / 'circles.sqlite3').st_mode), 0o600)
        self.server.shutdown()
        self.server.server_close()
        archive = self.root / 'notebook.zip'
        result = subprocess.run([sys.executable, '-m', 'challenges.backup', 'create', '--data-dir', str(self.data), '--output', str(archive)],
                                capture_output=True, text=True, timeout=120, cwd=Path(__file__).resolve().parents[1])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(archive.exists())

    def test_a_challenge_needs_both_participants_consent_before_the_circle_sees_it(self):
        circle_id, joe, terry, sam = self.circle()
        base = f'/api/circles/{circle_id}'
        status, view = self.request('POST', base + '/share', {'challengeId': self.challenge, 'seatToken': self.joe_seat}, joe)
        self.assertEqual(status, 200, view)
        self.assertEqual(view['pending'], [{'id': self.challenge, 'consented': ['proposer']}])
        self.assertEqual((view['challenges'], view['feed']), ([], []), 'one consent reveals nothing to the circle')
        self.assertEqual(self.request('POST', base + '/share', {'challengeId': self.challenge, 'seatToken': 'f' * 64}, sam)[0], 401)
        status, view = self.request('POST', base + '/share', {'challengeId': self.challenge, 'seatToken': self.terry_seat}, terry)
        self.assertEqual(([c['id'] for c in view['challenges']], view['pending']), ([self.challenge], []))

        terms_version = self.request('GET', self.endpoint, token=self.terry_seat)[1]['termsVersion']
        self.command('accept', self.terry_seat, termsVersion=terms_version)
        self.command('evidence', self.terry_seat, text='Crossed at 58:12! Legs are jelly.', url=None)
        proposal = self.command('result', self.joe_seat, outcome='opponent', reason='Terry beat the hour')['resultProposal']
        self.command('result/respond', self.terry_seat, proposalId=proposal['id'], accept=True, reason='')

        status, view = self.request('GET', base, token=sam)
        self.assertEqual(status, 200, view)
        kinds = [item['kind'] for item in view['feed']]
        self.assertEqual(kinds, ['settled', 'progress', 'agreed'])
        settled, progress, agreed = view['feed']
        self.assertEqual((settled['winner'], settled['method']), ('Terry', 'mutual'))
        self.assertEqual((progress['by'], progress['text'], progress['photo']), ('Terry', 'Crossed at 58:12! Legs are jelly.', False))
        self.assertEqual((agreed['proposer'], agreed['opponent'], agreed['stake']), ('Joe', 'Terry', 'doing the dishes'))
        self.assertNotIn('token', json.dumps(view).lower().replace('"me"', ''), 'no capabilities leave the service')

    def test_cheers_comments_withdrawal_and_leaving(self):
        circle_id, joe, terry, sam = self.circle()
        base = f'/api/circles/{circle_id}'
        for member, seat in ((joe, self.joe_seat), (terry, self.terry_seat)):
            self.request('POST', base + '/share', {'challengeId': self.challenge, 'seatToken': seat}, member)
        self.command('accept', self.terry_seat, termsVersion=1)
        item = self.request('GET', base, token=sam)[1]['feed'][0]['key']
        status, view = self.request('POST', base + '/cheer', {'item': item}, sam)
        self.assertEqual((view['feed'][0]['cheers'], view['feed'][0]['cheeredByMe']), (['Sam'], True))
        view = self.request('POST', base + '/cheer', {'item': item}, sam)[1]
        self.assertEqual(view['feed'][0]['cheers'], [], 'a second cheer toggles it off')
        self.assertEqual(self.request('POST', base + '/cheer', {'item': 'a' * 32 + '-1'}, sam)[0], 404)

        view = self.request('POST', base + '/comment', {'challengeId': self.challenge, 'text': 'You’ve got this, Terry!'}, sam)[1]
        comment = view['challenges'][0]['comments'][0]
        self.assertEqual((comment['by'], comment['mine']), ('Sam', True))
        self.assertEqual(self.request('POST', base + '/comment/delete', {'commentId': comment['id']}, joe)[0], 403)

        # Either participant can withdraw the challenge; its conversation goes with it.
        view = self.request('POST', base + '/unshare', {'challengeId': self.challenge, 'seatToken': self.terry_seat}, terry)[1]
        self.assertEqual((view['feed'], view['challenges'], view['pending']), ([], [], []))
        self.assertEqual(self.request('POST', base + '/comment', {'challengeId': self.challenge, 'text': 'Hello?'}, sam)[0], 404)

        self.assertEqual(self.request('POST', base + '/leave', {}, sam)[0], 200)
        self.assertEqual(self.request('GET', base, token=sam)[0], 401)
        names = [member['name'] for member in self.request('GET', base, token=joe)[1]['members']]
        self.assertEqual(names, ['Joe', 'Terry'])

    def test_departing_participant_withdraws_everyones_conversation(self):
        circle_id, joe, terry, sam = self.circle()
        base = f'/api/circles/{circle_id}'
        for member, seat in ((joe, self.joe_seat), (terry, self.terry_seat)):
            self.request('POST', base + '/share', {'challengeId': self.challenge, 'seatToken': seat}, member)
        self.command('accept', self.terry_seat, termsVersion=1)
        item = self.request('GET', base, token=sam)[1]['feed'][0]['key']
        self.request('POST', base + '/cheer', {'item': item}, sam)
        self.request('POST', base + '/comment', {'challengeId': self.challenge, 'text': 'Old conversation'}, sam)
        self.request('POST', base + '/leave', {}, terry)
        invite = self.request('POST', base + '/invite', {}, joe)[1]['inviteToken']
        rejoined = self.request('POST', base + '/join', {'inviteToken': invite, 'name': 'Terry'})[1]['token']
        self.request('POST', base + '/share', {'challengeId': self.challenge, 'seatToken': self.terry_seat}, rejoined)
        view = self.request('POST', base + '/share', {'challengeId': self.challenge, 'seatToken': self.joe_seat}, joe)[1]
        self.assertEqual(view['challenges'][0]['comments'], [])
        self.assertEqual(view['feed'][0]['cheers'], [])

    def test_invitations_rotate_and_limits_hold(self):
        status, created = self.request('POST', '/api/circles', {'circleName': 'Book club', 'name': 'Ana'})
        circle_id, ana = created['circleId'], created['token']
        rotated = self.request('POST', f'/api/circles/{circle_id}/invite', {}, ana)[1]['inviteToken']
        self.assertEqual(self.request('POST', f'/api/circles/{circle_id}/join', {'inviteToken': created['inviteToken'], 'name': 'Old'})[0], 404)
        for index in range(11):
            self.assertEqual(self.request('POST', f'/api/circles/{circle_id}/join', {'inviteToken': rotated, 'name': f'F{index}'})[0], 200)
        self.assertEqual(self.request('POST', f'/api/circles/{circle_id}/join', {'inviteToken': rotated, 'name': 'Thirteenth'})[0], 409)
        self.assertEqual(self.request('POST', '/api/circles', {'circleName': ' ', 'name': 'Ana'})[0], 400)
        self.assertEqual(self.request('GET', f'/api/circles/{circle_id}', token='0' * 64)[0], 401)

    def test_arbiters_cannot_share(self):
        circle_id, joe, _, _ = self.circle()
        status, created = self.request('POST', '/api/challenges', {'name': 'Kim', 'terms': dict(
            title='Read a book', description='Any book', successCriteria='Finish it', evidenceRule='Tell us',
            stake='bragging-rights', deadline=int(self.now * 1000) + 86400000)})
        self.assertEqual(self.request('POST', f'/api/circles/{circle_id}/share',
                                      {'challengeId': created['challengeId'], 'seatToken': self.joe_seat}, joe)[0], 401,
                         'a seat from another challenge is not consent')


class FeedDerivationTests(unittest.TestCase):
    def test_disputes_voids_and_terminal_states_are_described_without_private_fields(self):
        state = {'id': 'c' * 32, 'terms': {'title': 'Plank', 'stake': 'bragging-rights', 'deadline': 5, 'successCriteria': 'Two minutes'},
                 'profiles': {'proposer': {'name': 'A'}, 'opponent': {'name': 'B'}, 'arbiter': None},
                 'events': [{'seq': 1, 'at': 1, 'actor': 'opponent', 'kind': 'accepted', 'details': {}},
                            {'seq': 2, 'at': 2, 'actor': 'opponent', 'kind': 'result_responded', 'details': {'accept': False}},
                            {'seq': 3, 'at': 3, 'actor': 'proposer', 'kind': 'evidence_image_added',
                             'details': {'evidence': {'text': 'x' * 400, 'late': True, 'image': {'sha256': 'f' * 64}}}}],
                 'resolution': {'outcome': 'void', 'method': 'arbiter', 'reason': 'Unclear', 'decidedAt': 4}}
        items = feed_items(state)
        self.assertEqual([item['kind'] for item in items], ['agreed', 'disputed', 'progress', 'voided'])
        self.assertTrue(items[2]['photo'] and items[2]['late'])
        self.assertEqual(len(items[2]['text']), 280)
        self.assertNotIn('sha256', json.dumps(items))


if __name__ == '__main__':
    unittest.main()
