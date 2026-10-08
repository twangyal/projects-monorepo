"""Authoring uses the existing real HTTP/CLI context publication authority."""
from copy import deepcopy
import http.client
from importlib.resources import files
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest

from git_history.workbench import create_server
from tests.helpers import Repository
from tests.test_report import Links


class ContextAuthoringWorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.addCleanup(self.repo.close)
        self.repo.write('app.py', 'value = 1\n')
        self.first = self.repo.commit('Introduce value')
        self.repo.write('app.py', 'value = 2\n')
        self.second = self.repo.commit('Change value')
        self.repo.write('app.py', 'value = 3\n')
        self.third = self.repo.commit('Change value again')
        self.repo.write('unrelated.txt', 'Not source evidence\n')
        self.revision = self.repo.commit('Unrelated selected revision')
        self.server = create_server(self.repo.path)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.port = self.server.server_address[1]
        self.host = f'127.0.0.1:{self.port}'
        self.document = {
            'schema_version': 1, 'revision': self.revision,
            'records': [{
                'commit': self.second,
                'url': 'https://github.com/owner/repo/pull/42#issuecomment-123',
                'title': '  Literal <title> café 🧵  ', 'author': '\t<Author>\t',
                'excerpt': '  <script>alert(1)</script>\nLiteral token/password discussion. 🧵  ',
            }],
        }

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)
        self.assertFalse(self.thread.is_alive(), 'Owned HTTP accept loop survived cleanup')

    def request(self, path, value=None, *, method='POST', headers=None):
        body = None if method == 'GET' else json.dumps(value or {}).encode()
        sent = {'Host': self.host, 'Origin': self.server.origin,
                'X-Git-History-Token': self.server.token, 'Content-Type': 'application/json'}
        for key, item in (headers or {}).items():
            if item is None:
                sent.pop(key, None)
            else:
                sent[key] = item
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=sent)
            response = connection.getresponse()
            return response.status, {key.lower(): item for key, item in response.getheaders()}, response.read()
        finally:
            connection.close()

    def report(self, document=None, *, revision=None, maximum=3, path='app.py', selection=None):
        context = json.dumps(document, ensure_ascii=False) if document is not None else None
        status, _, raw = self.request('/api/jobs', {'operation': 'report', 'args': {
            'revision': revision or self.revision, 'path': path,
            'selection': selection or {'start': 1, 'end': 1},
            'max_commits': maximum, 'context': context,
        }})
        self.assertEqual(status, 202, raw)
        identifier = json.loads(raw)['id']
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            status, _, raw = self.request('/api/result', {'id': identifier})
            self.assertEqual(status, 200, raw)
            result = json.loads(raw)
            if result['state'] != 'pending':
                return result
            time.sleep(.02)
        self.fail('Real context report did not finish within the test deadline')

    def completed(self, document=None, **options):
        job = self.report(document, **options)
        self.assertEqual(job['state'], 'complete', job)
        return job['result'], json.loads(job['result']['json'])

    def refused(self, document, message, **options):
        job = self.report(document, **options)
        self.assertEqual(job['state'], 'error', job)
        self.assertNotIn('result', job)
        self.assertIn(message, job['error'])
        self.assertNotIn(self.document['records'][0]['excerpt'], job['error'])
        self.assertNotIn(self.server.token, job['error'])

    def test_only_exact_packaged_module_is_served_with_existing_security_policy(self):
        status, headers, raw = self.request('/context-editor.js', method='GET', headers={
            'Origin': None, 'X-Git-History-Token': None,
        })
        self.assertEqual(status, 200, raw[:200])
        self.assertEqual(headers['content-type'], 'text/javascript; charset=utf-8')
        self.assertEqual(raw, files('git_history').joinpath('web/context-editor.js').read_bytes())
        self.assertEqual(headers['x-content-type-options'], 'nosniff')
        self.assertEqual(headers['referrer-policy'], 'no-referrer')
        self.assertIn('no-store', headers['cache-control'])
        self.assertIn('content-security-policy', headers)
        self.assertNotIn('set-cookie', headers)
        self.assertNotIn('access-control-allow-origin', headers)
        self.assertNotIn(self.server.token.encode(), raw)
        for target in ('/web/context-editor.js', '/context-editor.js?download=1',
                       '/./context-editor.js', '/context-editor.js/', '/context.py',
                       '/model.py', '/../context-editor.js'):
            with self.subTest(target=target):
                self.assertEqual(self.request(target, method='GET')[0], 404)
        self.assertEqual(self.request('/context-editor.js')[0], 405)
        for extra in ({'Host': 'attacker.invalid'}, {'Sec-Fetch-Site': 'cross-site'}):
            self.assertEqual(self.request('/context-editor.js', method='GET', headers=extra)[0], 403)
        self.assertEqual(self.request('/api/session', headers={'X-Git-History-Token': None})[0], 403)

    def test_both_literal_formats_match_actual_cli_html_and_json_exactly(self):
        record = self.document['records'][0]
        legacy = {'schema_version': 1, 'entries': [{
            'commit': record['commit'], 'source': record['title'],
            'url': record['url'], 'author': record['author'], 'excerpt': record['excerpt'],
        }]}
        before = self.repo.git('status', '--porcelain')
        for document in (self.document, legacy):
            with self.subTest(format='records' if 'records' in document else 'entries'):
                result, rendered = self.completed(document)
                supplied = rendered['supplied_context']
                if 'records' in document:
                    self.assertEqual(supplied, document['records'])
                    self.assertIn('not verified', rendered['supplied_context_note'])
                else:
                    self.assertEqual(supplied['entries'][0]['excerpt'], record['excerpt'])
                    self.assertEqual(supplied['entries'][0]['source'], record['title'])
                    self.assertIn('Unverified', supplied['provenance'])
                parsed = Links()
                parsed.feed(result['html'])
                self.assertNotIn('script', parsed.tags)
                self.assertIn(record['url'], parsed.links)
                self.assertIn('#commit-' + self.second, parsed.links)
                self.assertIn('commit-' + self.second, parsed.ids)
                self.assertIn('&lt;script&gt;', result['html'])
                with tempfile.TemporaryDirectory() as directory:
                    context_path = Path(directory) / 'literal context.json'
                    context_path.write_text(json.dumps(document, ensure_ascii=False), encoding='utf-8')
                    for format_name in ('html', 'json'):
                        command = [sys.executable, '-m', 'git_history', 'explain',
                                   '--repo', str(self.repo.path), '--ref', self.revision,
                                   '--file', 'app.py', '--lines', '1:1', '--max-commits', '3',
                                   '--context', str(context_path), '--format', format_name]
                        cli = subprocess.run(command, capture_output=True, timeout=10)
                        self.assertEqual(cli.returncode, 0, cli.stderr)
                        self.assertEqual(cli.stdout, result[format_name].encode('utf-8'))
        self.assertEqual(self.repo.git('status', '--porcelain'), before)
        self.assertEqual(self.repo.git('rev-parse', 'HEAD').decode().strip(), self.revision)

    def test_selected_revision_alone_is_not_displayed_evidence_but_legacy_acceptance_remains(self):
        _, evidence = self.completed()
        represented = {item['commit'] for key in ('blame', 'changes', 'renames') for item in evidence[key]}
        self.assertEqual({self.first, self.second, self.third}, represented)
        self.assertNotIn(self.revision, represented)
        document = deepcopy(self.document)
        document['records'][0]['commit'] = self.revision
        self.refused(document, 'exact commit in displayed evidence')
        item = document['records'][0]
        legacy = {'schema_version': 1, 'entries': [{
            'commit': item['commit'], 'source': item['title'], 'author': item['author'],
            'url': item['url'], 'excerpt': item['excerpt'],
        }]}
        _, rendered = self.completed(legacy)
        self.assertEqual(rendered['supplied_context']['entries'][0]['commit'], self.revision)

    def test_reduced_history_and_changed_selection_revalidate_every_record(self):
        self.completed(self.document)
        _, shortened = self.completed(maximum=1)
        self.assertEqual([item['commit'] for item in shortened['changes']], [self.third])
        self.refused(self.document, 'exact commit in displayed evidence', maximum=1)
        self.repo.write('other.py', 'different = True\n')
        new_revision = self.repo.commit('Add a different source selection')
        rebound = deepcopy(self.document)
        rebound['revision'] = new_revision
        self.refused(rebound, 'exact commit in displayed evidence', revision=new_revision, path='other.py')
        self.completed(self.document)

    def test_moving_head_does_not_move_pinned_context_and_new_revision_refuses_old_envelope(self):
        self.repo.write('app.py', 'value = 4\n')
        moved = self.repo.commit('Move HEAD after drafting')
        _, pinned = self.completed(self.document)
        self.assertEqual(pinned['revision'], self.revision)
        self.assertEqual(pinned['source'], 'value = 3\n')
        self.refused(self.document, 'exact resolved commit ID', revision=moved)
        self.assertEqual(self.repo.git('rev-parse', 'HEAD').decode().strip(), moved)

    def test_rename_evidence_is_an_authoritative_association(self):
        self.repo.git('mv', 'app.py', 'renamed.py')
        renamed = self.repo.commit('Rename unchanged source')
        _, plain = self.completed(revision=renamed, path='renamed.py')
        self.assertIn({'commit': renamed, 'old_path': 'app.py', 'new_path': 'renamed.py',
                       'similarity': 100}, plain['renames'])
        document = deepcopy(self.document)
        document['revision'] = renamed
        document['records'][0]['commit'] = renamed
        result, rendered = self.completed(document, revision=renamed, path='renamed.py')
        self.assertEqual(rendered['supplied_context'], document['records'])
        self.assertIn('id="commit-' + renamed + '"', result['html'])

    def test_authority_enforces_record_and_utf8_bounds_without_partial_result(self):
        maximum = deepcopy(self.document)
        maximum['records'] = [{**maximum['records'][0], 'excerpt': 'x' * 4000} for _ in range(50)]
        self.assertLess(len(json.dumps(maximum, ensure_ascii=False).encode()), 256 * 1024)
        _, rendered = self.completed(maximum)
        self.assertEqual(len(rendered['supplied_context']), 50)
        over_count = deepcopy(maximum)
        over_count['records'].append(deepcopy(over_count['records'][0]))
        self.refused(over_count, 'at most 50')
        over_bytes = deepcopy(maximum)
        over_bytes['records'] = [{**over_bytes['records'][0], 'excerpt': '🧵' * 4000} for _ in range(20)]
        self.assertGreater(len(json.dumps(over_bytes, ensure_ascii=False).encode()), 256 * 1024)
        # The HTTP admission guard already checks UTF-8 bytes, before any job
        # is created; this is stricter than waiting for the context parser.
        status, _, raw = self.request('/api/jobs', {'operation': 'report', 'args': {
            'revision': self.revision, 'path': 'app.py',
            'selection': {'start': 1, 'end': 1}, 'max_commits': 3,
            'context': json.dumps(over_bytes, ensure_ascii=False),
        }})
        self.assertEqual(status, 400)
        self.assertEqual(set(json.loads(raw)), {'error'})
        self.assertNotIn(over_bytes['records'][0]['excerpt'].encode(), raw)
        unsafe = deepcopy(self.document)
        unsafe['records'][0]['url'] = 'https://secret@github.com/owner/repo/pull/42'
        job = self.report(unsafe)
        self.assertEqual(job['state'], 'error', job)
        self.assertNotIn('result', job)
        self.assertNotIn(unsafe['records'][0]['url'], job['error'])
        self.completed(self.document)


if __name__ == '__main__':
    unittest.main()
