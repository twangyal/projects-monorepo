"""A loopback stand-in for the GitHub REST API endpoints Git History reads.

It follows the documented response shapes for commit-associated pull requests, pull-request
review comments and reviews, issue comments and issues. Tests fill `pulls`, `comments`,
`reviews`, `conversation` and `issues`, and can inject failures by path prefix.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import threading
from urllib.parse import parse_qs, urlsplit


class FakeGitHub:
    def __init__(self, owner='acme', repo='widgets'):
        self.owner, self.repo = owner, repo
        self.commit_pulls: dict[str, list[int]] = {}
        self.pulls: dict[int, dict] = {}
        self.comments: dict[int, list[dict]] = {}
        self.reviews: dict[int, list[dict]] = {}
        self.conversation: dict[int, list[dict]] = {}
        self.issues: dict[int, dict] = {}
        self.failures: list[tuple[str, int, dict]] = []
        self.requests: list[tuple[str, dict]] = []
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def send(self, status, value, headers=None):
                body = json.dumps(value).encode()
                self.send_response(status)
                for key, item in (headers or {}).items():
                    self.send_header(key, item)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                path = urlsplit(self.path).path
                fake.requests.append((self.path, dict(self.headers)))
                prefix = f'/repos/{fake.owner}/{fake.repo}'
                for index, (start, status, headers) in enumerate(fake.failures):
                    if path.startswith(prefix + start):
                        del fake.failures[index]
                        return self.send(status, {'message': 'failure'}, headers)
                if not path.startswith(prefix):
                    return self.send(404, {'message': 'Not Found'})
                route = path[len(prefix):]
                if match := re.fullmatch(r'/commits/([0-9a-f]{40})/pulls', route):
                    return self.send(200, [fake.pulls[number] for number in fake.commit_pulls.get(match.group(1), [])])
                if match := re.fullmatch(r'/pulls/([0-9]+)/comments', route):
                    return self.send(200, fake.comments.get(int(match.group(1)), []))
                if match := re.fullmatch(r'/pulls/([0-9]+)/reviews', route):
                    return self.send(200, fake.reviews.get(int(match.group(1)), []))
                if match := re.fullmatch(r'/issues/([0-9]+)/comments', route):
                    params = parse_qs(urlsplit(self.path).query)
                    size = int(params.get('per_page', ['30'])[0])
                    page = int(params.get('page', ['1'])[0])
                    values = fake.conversation.get(int(match.group(1)), [])
                    return self.send(200, values[(page - 1) * size:page * size])
                if match := re.fullmatch(r'/issues/([0-9]+)', route):
                    issue = fake.issues.get(int(match.group(1)))
                    return self.send(200, issue) if issue else self.send(404, {'message': 'Not Found'})
                return self.send(404, {'message': 'Not Found'})

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.url = f'http://127.0.0.1:{self.server.server_port}'
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()

    # Documented shapes, with only the fields the tool reads plus realistic extras.
    def pull(self, number, title, body, *, user='octo', merged_at='2026-01-02T03:04:05Z', created_at='2026-01-01T00:00:00Z'):
        self.pulls[number] = {
            'number': number, 'title': title, 'body': body, 'state': 'closed', 'merged_at': merged_at,
            'created_at': created_at, 'user': {'login': user, 'id': 1}, 'draft': False,
            'html_url': f'https://github.com/{self.owner}/{self.repo}/pull/{number}',
            'base': {'ref': 'main'}, 'head': {'ref': 'feature'},
        }

    def review_comment(self, number, comment_id, path, body, *, user='reviewer', line=3):
        return {'id': comment_id, 'path': path, 'line': line, 'original_line': line, 'body': body,
                'user': {'login': user}, 'created_at': '2026-01-01T10:00:00Z',
                'html_url': f'https://github.com/{self.owner}/{self.repo}/pull/{number}#discussion_r{comment_id}'}

    def review(self, number, review_id, body, state='COMMENTED', user='lead'):
        return {'id': review_id, 'state': state, 'body': body, 'user': {'login': user},
                'submitted_at': '2026-01-01T11:00:00Z',
                'html_url': f'https://github.com/{self.owner}/{self.repo}/pull/{number}#pullrequestreview-{review_id}'}

    def comment(self, number, comment_id, body, user='octo'):
        return {'id': comment_id, 'body': body, 'user': {'login': user}, 'created_at': '2026-01-01T12:00:00Z',
                'html_url': f'https://github.com/{self.owner}/{self.repo}/pull/{number}#issuecomment-{comment_id}'}

    def issue(self, number, title, body, user='reporter'):
        self.issues[number] = {'number': number, 'title': title, 'body': body, 'state': 'closed', 'user': {'login': user},
                               'html_url': f'https://github.com/{self.owner}/{self.repo}/issues/{number}'}
