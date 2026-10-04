from copy import deepcopy
import unittest

from challenges import domain


def active_state():
    state = domain.create_state('1' * 32, dict(name='Alex', terms=dict(
        title='Read together', description='Literal <script> & "notes" 🎵',
        successCriteria='Finish', evidenceRule='Supplied notes and images',
        stake='pick-a-movie', deadline=2000)), 1000)
    domain.apply_claim(state, 'opponent', 'Sam', 1100)
    domain.apply_command(state, 'opponent', 'accept', dict(revision=2, termsVersion=1), 1200)
    return state


def descriptor(**patch):
    return dict(mime='image/jpeg', bytes=512288, width=1024, height=768,
                sha256='a' * 64, **patch)


def record(state, version=1):
    return dict(schemaVersion=version, state=deepcopy(state), hashes=dict(
        proposer='b' * 64, opponent='c' * 64, arbiter=None,
        opponentInvite=None, arbiterInvite=None))


class ImageDomainTests(unittest.TestCase):
    def append(self, state, **patch):
        domain.apply_image_evidence(state, 'proposer',
                                    dict(revision=state['revision'], text='Literal <img> 🎵', url=None),
                                    descriptor(), patch.get('now', 2100), patch.get('id', '2' * 32))

    def test_descriptor_exact_bounds_and_detachment(self):
        value = {**descriptor(), 'bytes': 524288, 'height': 1024}
        admitted = domain.validate_image_descriptor(value)
        self.assertEqual(admitted, value)
        self.assertIsNot(admitted, value)
        self.assertEqual(domain.validate_image_descriptor(
            dict(mime='image/jpeg', bytes=1, width=1, height=1, sha256='0' * 64))['bytes'], 1)

    def test_descriptor_rejects_unknown_missing_noninteger_and_unsafe_values(self):
        patches = [dict(extra=True), dict(mime='image/png'), dict(bytes=0), dict(bytes=524289),
                   dict(bytes=True), dict(width=0), dict(width=1025), dict(height=1.5),
                   dict(height=False), dict(sha256='A' * 64), dict(sha256='a' * 63),
                   dict(sha256='a' * 64 + '\n')]
        for patch in patches:
            with self.subTest(patch=patch), self.assertRaises(domain.DomainError):
                domain.validate_image_descriptor({**descriptor(), **patch})
        for key in descriptor():
            value = descriptor()
            del value[key]
            with self.subTest(missing=key), self.assertRaises(domain.DomainError):
                domain.validate_image_descriptor(value)

    def test_image_transition_exact_event_and_copy(self):
        state = active_state()
        image = descriptor()
        payload = dict(revision=3, text=' Literal <img> 🎵\n ', url='https://example.org/item#note')
        domain.apply_image_evidence(state, 'opponent', payload, image, 2000, '2' * 32)
        expected = dict(id='2' * 32, author='opponent', text=payload['text'], url=payload['url'],
                        createdAt=2000, late=True, image=image)
        self.assertEqual(state['revision'], 4)
        self.assertEqual(state['evidence'], [expected])
        self.assertEqual(state['events'][-1], dict(seq=4, at=2000, actor='opponent',
                         kind='evidence_image_added', details=dict(evidence=expected)))
        image['width'] = 1
        self.assertEqual(state['evidence'][0]['image']['width'], 1024)
        state['evidence'][0]['image']['width'] = 2
        self.assertEqual(state['events'][-1]['details']['evidence']['image']['width'], 1024)

    def test_old_text_event_shape_and_record_bytes_unchanged(self):
        state = active_state()
        domain.apply_command(state, 'proposer', 'evidence',
                             dict(revision=3, text='An old note', url=None), 1400, '3' * 32)
        value = record(state)
        before = domain.encode_json(value)
        self.assertEqual(domain.encode_json(domain.validate_record(value)), before)
        self.assertEqual(set(state['evidence'][0]), set('id author text url createdAt late'.split()))
        self.assertEqual(state['events'][-1]['kind'], 'evidence_added')
        self.assertEqual(domain.validate_record(record(state, 2))['schemaVersion'], 2)
        self.assertEqual(domain.encode_json(value), before)

    def test_schema_two_replays_mixed_old_image_and_following_text(self):
        state = active_state()
        domain.apply_command(state, 'proposer', 'evidence',
                             dict(revision=3, text='Old', url=None), 1300, '3' * 32)
        self.append(state, now=1400)
        domain.apply_command(state, 'opponent', 'evidence',
                             dict(revision=5, text='Following old shape', url=None), 1500, '4' * 32)
        value = record(state, 2)
        self.assertEqual(domain.validate_record(value), value)
        with self.assertRaises(domain.DomainError) as caught:
            domain.validate_record(record(state, 1))
        self.assertEqual(caught.exception.code, 'internal_error')
        self.assertEqual(domain._replay(state['events'], state['id'], 2), state)

    def test_historical_receipt_and_backward_clock_are_preserved(self):
        state = active_state()
        self.append(state, now=2100)
        self.append(state, now=1250, id='3' * 32)
        self.assertEqual([item['late'] for item in state['evidence']], [True, False])
        self.assertEqual(domain.validate_record(record(state, 2))['state'], state)

    def test_image_quota_is_separate_from_total_evidence_quota(self):
        state = active_state()
        for index in range(8):
            self.append(state, id=f'{index + 10:032x}')
        before = deepcopy(state)
        with self.assertRaises(domain.DomainError) as caught:
            self.append(state, id='f' * 32)
        self.assertEqual(caught.exception.code, 'limit')
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(state, before)
        domain.apply_command(state, 'proposer', 'evidence',
                             dict(revision=state['revision'], text='Text still allowed', url=None),
                             2200, 'e' * 32)
        self.assertEqual(len(state['evidence']), 9)

    def test_total_evidence_quota_blocks_image_atomically(self):
        state = active_state()
        for index in range(40):
            domain.apply_command(state, 'proposer', 'evidence',
                                 dict(revision=state['revision'], text='Text', url=None),
                                 1400, f'{index + 10:032x}')
        before = deepcopy(state)
        with self.assertRaises(domain.DomainError) as caught:
            self.append(state)
        self.assertEqual(caught.exception.code, 'limit')
        self.assertEqual(state, before)

    def test_invalid_command_descriptor_clock_role_and_collision_are_atomic(self):
        for role, payload, image, now, entity_id in [
            ('arbiter', dict(revision=3, text='A', url=None), descriptor(), 1300, '2' * 32),
            ('proposer', dict(revision=2, text='A', url=None), descriptor(), 1300, '2' * 32),
            ('proposer', dict(revision=3, text='A', url=None, image=descriptor()), descriptor(), 1300, '2' * 32),
            ('proposer', dict(revision=3, text='A', url='javascript:x'), descriptor(), 1300, '2' * 32),
            ('proposer', dict(revision=3, text='A', url=None), {**descriptor(), 'bytes': 0}, 1300, '2' * 32),
            ('proposer', dict(revision=3, text='A', url=None), descriptor(), True, '2' * 32),
            ('proposer', dict(revision=3, text='A', url=None), descriptor(), 1300, '1' * 32),
        ]:
            state = active_state()
            before = deepcopy(state)
            with self.subTest(role=role, payload=payload, now=now), self.assertRaises(domain.DomainError):
                domain.apply_image_evidence(state, role, payload, image, now, entity_id)
            self.assertEqual(state, before)

    def test_proposed_and_terminal_states_do_not_accept_images(self):
        for status in ('proposed', 'resolved', 'voided', 'declined', 'withdrawn'):
            state = active_state()
            state['status'] = status
            before = deepcopy(state)
            with self.subTest(status=status), self.assertRaises(domain.DomainError):
                self.append(state)
            self.assertEqual(state, before)

    def test_replay_rejects_forged_descriptor_late_author_and_old_event_image(self):
        state = active_state()
        self.append(state)
        for patch in (dict(late=False), dict(author='opponent'), dict(extra=True),
                      dict(image={**descriptor(), 'bytes': True})):
            value = record(state, 2)
            value['state']['events'][-1]['details']['evidence'].update(patch)
            value['state']['evidence'][-1].update(patch)
            with self.subTest(patch=patch), self.assertRaises(domain.DomainError):
                domain.validate_record(value)
        value = record(state, 2)
        value['state']['events'][-1]['kind'] = 'evidence_added'
        with self.assertRaises(domain.DomainError):
            domain.validate_record(value)
        for version in (True, 0, 3, 2.0):
            value = record(state, version)
            with self.subTest(version=version), self.assertRaises(domain.DomainError):
                domain.validate_record(value)


if __name__ == '__main__':
    unittest.main()
