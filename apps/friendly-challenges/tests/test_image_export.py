import base64
from copy import deepcopy
import hashlib
from html.parser import HTMLParser
from io import BytesIO
import unittest
from unittest.mock import patch

from PIL import Image

from challenges import domain, image_export
from tests.test_image_domain import active_state


class RecordParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.images = []
        self.tags = []
        self.text = []
        self.attributes = []

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        self.attributes.extend(attrs)
        if tag == 'img':
            self.images.append(dict(attrs)['src'])

    def handle_data(self, data):
        self.text.append(data)


def fixture(count=1):
    stream = BytesIO()
    Image.new('RGB', (3, 2), (120, 50, 10)).save(stream, format='JPEG')
    jpeg = stream.getvalue()
    descriptor = dict(mime='image/jpeg', bytes=len(jpeg), width=3, height=2,
                      sha256=hashlib.sha256(jpeg).hexdigest())
    state = active_state()
    images = []
    for index in range(count):
        evidence_id = f'{index + 10:032x}'
        domain.apply_image_evidence(state, 'proposer', dict(
            revision=state['revision'], text='Literal </pre><script>alert(1)</script> & 🎵\r\n',
            url='https://example.org/item#note'), descriptor, 2100 + index, evidence_id)
        images.append((evidence_id, deepcopy(descriptor), jpeg))
    state['deadlinePassed'] = True
    return dict(schemaVersion=2 if count else 1, exportedAt=2200, challenge=state), images


class ImageExportTests(unittest.TestCase):
    def test_complete_script_free_literal_record_and_exact_image_bytes(self):
        public, images = fixture()
        before = deepcopy(public)
        output = image_export.render_image_export(public, images)
        self.assertIs(type(output), bytes)
        parsed = RecordParser()
        parsed.feed(output.decode('utf-8'))
        self.assertEqual(len(parsed.images), 1)
        prefix = 'data:image/jpeg;base64,'
        self.assertTrue(parsed.images[0].startswith(prefix))
        self.assertEqual(base64.b64decode(parsed.images[0][len(prefix):], validate=True), images[0][2])
        literal = ''.join(parsed.text)
        for value in ['Read together', 'Finish', 'Supplied notes and images', 'pick-a-movie',
                      'Literal </pre><script>alert(1)</script> & 🎵\r\n',
                      'proposer', images[0][1]['sha256'], 'evidence_image_added', 'late', '2100']:
            self.assertIn(value, literal)
        self.assertNotIn('script', parsed.tags)
        self.assertNotIn('iframe', parsed.tags)
        self.assertNotIn('object', parsed.tags)
        self.assertFalse(any(name.startswith('on') for name, _ in parsed.attributes))
        self.assertNotIn('hashes', output.decode())
        self.assertIn('not verified', literal)
        self.assertEqual(public, before)

    def test_old_text_only_export_remains_valid_without_inventing_image_field(self):
        public, images = fixture(0)
        output = image_export.render_image_export(public, images)
        self.assertNotIn(b'data:image/jpeg', output)
        self.assertIn(b'accepted', output)
        self.assertIn(b'"schemaVersion":1', output)
        self.assertNotIn(b'&quot;image&quot;', output)

    def test_eight_images_preserve_evidence_order_and_exact_hashes(self):
        public, images = fixture(8)
        parsed = RecordParser()
        output = image_export.render_image_export(public, images)
        parsed.feed(output.decode())
        self.assertEqual(len(parsed.images), 8)
        positions = [output.index(eid.encode()) for eid, _, _ in images]
        self.assertEqual(positions, sorted(positions))
        for src, (_, descriptor, jpeg) in zip(parsed.images, images):
            self.assertEqual(hashlib.sha256(base64.b64decode(src.split(',', 1)[1])).hexdigest(),
                             descriptor['sha256'])
            self.assertEqual(base64.b64decode(src.split(',', 1)[1]), jpeg)

    def test_missing_extra_duplicate_wrong_order_and_changed_descriptor_reject(self):
        public, images = fixture(2)
        wrong = deepcopy(images[0][1])
        wrong['width'] = 4
        cases = [[], images[:1], images + [images[0]], images[::-1],
                 [images[0], images[0]], [(images[0][0], wrong, images[0][2]), images[1]],
                 [('f' * 32, images[0][1], images[0][2]), images[1]],
                 [(images[0][0], images[0][1], bytearray(images[0][2])), images[1]]]
        for value in cases:
            with self.subTest(length=len(value)), self.assertRaises(domain.DomainError):
                image_export.render_image_export(public, value)

    def test_changed_bytes_and_hash_matching_nonjpeg_fail(self):
        public, images = fixture()
        eid, descriptor, jpeg = images[0]
        with self.assertRaises(domain.DomainError):
            image_export.render_image_export(public, [(eid, descriptor, jpeg[:-1] + b'x')])
        bad = b'not a JPEG'
        descriptor = {**descriptor, 'bytes': len(bad), 'sha256': hashlib.sha256(bad).hexdigest()}
        public['challenge']['evidence'][0]['image'] = descriptor
        public['challenge']['events'][-1]['details']['evidence']['image'] = descriptor
        with self.assertRaises(domain.DomainError):
            image_export.render_image_export(public, [(eid, descriptor, bad)])

    def test_private_extra_fields_forged_audit_and_wrong_export_clock_reject(self):
        public, images = fixture()
        cases = []
        for key, value in [('hashes', {'proposer': 'b' * 64}), ('token', 'b' * 64),
                           ('schemaVersion', 1), ('exportedAt', True)]:
            cases.append({**deepcopy(public), key: value})
        forged = deepcopy(public)
        forged['challenge']['evidence'][0]['text'] = 'A substituted caption'
        cases.append(forged)
        forged = deepcopy(public)
        forged['challenge']['deadlinePassed'] = False
        cases.append(forged)
        for value in cases:
            with self.subTest(keys=list(value)), self.assertRaises(domain.DomainError):
                image_export.render_image_export(value, images)

    def test_exact_utf8_output_ceiling_and_one_byte_over_are_atomic(self):
        public, images = fixture()
        output = image_export.render_image_export(public, images)
        with patch.object(image_export, 'MAX_IMAGE_EXPORT_BYTES', len(output)):
            self.assertEqual(image_export.render_image_export(public, images), output)
        before = deepcopy(public)
        with patch.object(image_export, 'MAX_IMAGE_EXPORT_BYTES', len(output) - 1):
            with self.assertRaises(domain.DomainError) as caught:
                image_export.render_image_export(public, images)
            self.assertEqual(caught.exception.code, 'limit')
        self.assertEqual(public, before)
        self.assertLess(len(output), 12 * 1024 * 1024)


if __name__ == '__main__':
    unittest.main()
