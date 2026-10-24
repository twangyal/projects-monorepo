"""Opt-in retrieval of GitHub pull-request discussions for commits already in a report.

Only commits shown in the report are looked up. Every response is size- and time-bounded and
validated into small records; text is what participants wrote, quoted, never treated as
verified intent. Nothing is fetched unless the caller asks for it.
"""

from datetime import datetime, timezone
import json
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .model import ReferencedIssue, Report, RetrievedComment, RetrievedDiscussions, RetrievedIssue, RetrievedPull
from .work_budget import check_work_budget, current_work_budget

API_URL = 'https://api.github.com'
MAX_COMMITS = 12
MAX_PULLS = 8
MAX_COMMENTS = 30
MAX_LINKED_ISSUES = 3
MAX_REFERENCED_ISSUES = 8
ISSUE_COMMENT_PAGE = 10
MAX_TEXT = 4000
MAX_RESPONSE = 2 * 1024 * 1024
TIMEOUT = 15
DEADLINE = 60
_NAME = r'[A-Za-z0-9_.-]{1,100}'
_CLOSES = re.compile(r'\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#([0-9]{1,9})\b', re.IGNORECASE)

_REFERENCES = re.compile(r'\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|references?)\s*:?\s+#([1-9][0-9]{0,8})\b|(?<![\w/])\(#([1-9][0-9]{0,8})\)', re.IGNORECASE)

PROVENANCE = ('Retrieved from GitHub for commits shown in this report. Titles, descriptions, reviews '
              'and comments are what participants wrote; they can explain intent but are not verified '
              'by this tool, and the discussion may be incomplete or later edited.')


class DiscussionError(ValueError):
    """Retrieval cannot start (for example, no GitHub origin)."""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class _Stop(Exception):
    """Retrieval must stop; earlier results remain valid."""


def github_repository(remote_url: str | None) -> tuple[str, str]:
    """The owner and repository of a recognized github.com origin."""
    match = re.fullmatch(rf'https://github\.com/({_NAME})/({_NAME})', remote_url or '')
    if not match or match.group(2) in ('.', '..'):
        raise DiscussionError('Discussion retrieval needs a github.com origin remote for this repository.')
    return match.group(1), match.group(2)


def _api_base(value: str) -> str:
    """The real API, or a loopback test double; nothing else is contacted."""
    parsed = urlsplit(value)
    if value == API_URL:
        return value
    if parsed.scheme == 'http' and parsed.hostname == '127.0.0.1' and parsed.port and not parsed.path.strip('/') \
            and not parsed.query and not parsed.username:
        return f'http://127.0.0.1:{parsed.port}'
    raise DiscussionError('The GitHub API address must be https://api.github.com (or a loopback test server).')


def _text(value, limit=MAX_TEXT) -> tuple[str, bool]:
    if value is None:
        return '', False
    if type(value) is not str:
        raise ValueError
    # Normalize line endings; drop control characters other than newline and tab.
    value = re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', '', value.replace('\r\n', '\n').replace('\r', '\n'))
    return (value[:limit], True) if len(value) > limit else (value, False)


def _login(value) -> str:
    if type(value) is dict and type(value.get('login')) is str and re.fullmatch(r'[A-Za-z0-9-]{1,39}(\[bot\])?', value['login']):
        return value['login']
    return 'unknown'


def _time(value) -> str:
    if type(value) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', value):
        return value
    raise ValueError


class GitHubClient:
    """Minimal, bounded reader for the GitHub REST API."""

    def __init__(self, owner: str, repo: str, *, api_url: str = API_URL, token: str | None = None,
                 timeout: float = TIMEOUT, deadline: float = DEADLINE, clock=time.monotonic):
        self.owner, self.repo = owner, repo
        self.base = _api_base(api_url)
        self.token = token if token and re.fullmatch(r'[A-Za-z0-9_.-]{1,255}', token) else None
        self.timeout, self.clock = timeout, clock
        self.expires = clock() + deadline
        self.opener = build_opener(_NoRedirect)
        self.requests = 0

    def get(self, path: str):
        # A workbench job's cancellation and aggregate deadline apply between requests.
        check_work_budget()
        if self.clock() > self.expires:
            raise _Stop('Retrieval reached its time limit; later lookups were skipped.')
        budget = current_work_budget()
        timeout = self.timeout if budget is None else max(0.1, min(self.timeout, budget.deadline - time.monotonic()))
        headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
                   'User-Agent': 'local-git-history'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        self.requests += 1
        try:
            with self.opener.open(Request(f'{self.base}/repos/{self.owner}/{self.repo}{path}', headers=headers),
                                  timeout=timeout) as response:
                body = response.read(MAX_RESPONSE + 1)
        except HTTPError as error:
            remaining = error.headers.get('X-RateLimit-Remaining') if error.headers else None
            if error.code == 429 or (error.code == 403 and remaining == '0'):
                raise _Stop('GitHub rate limit reached; later lookups were skipped. Set GITHUB_TOKEN to raise the limit.') from None
            if error.code in (401, 403):
                raise _Stop(f'GitHub refused access ({error.code}); later lookups were skipped. '
                            'For a private repository set GITHUB_TOKEN to a token that can read it.') from None
            if error.code == 404:
                return None
            raise _Stop(f'GitHub returned an error ({error.code}); later lookups were skipped.') from None
        except (URLError, TimeoutError, OSError):
            raise _Stop('GitHub could not be reached; later lookups were skipped.') from None
        if len(body) > MAX_RESPONSE:
            raise _Stop('GitHub sent an unexpectedly large response; later lookups were skipped.')
        try:
            return json.loads(body.decode('utf-8'))
        except (UnicodeDecodeError, ValueError):
            raise _Stop('GitHub sent an unreadable response; later lookups were skipped.') from None


NOT_FETCHED = ' PR and issue discussions were not fetched.'


def attach_discussions(report: Report, retrieved: RetrievedDiscussions) -> None:
    """Add retrieved discussion to a report, keeping its completeness statements true."""
    report.retrieved_discussions = retrieved
    report.warnings = [warning.replace(NOT_FETCHED, ' Pull-request discussion was retrieved from GitHub for report '
                                                    'commits, along with explicitly referenced direct-commit issues; it is quoted, not verified.') for warning in report.warnings]


def _all_commits(report: Report) -> list[str]:
    return [change.commit for change in report.changes] + [line.commit for line in report.blame]


def _commits(report: Report) -> list[str]:
    """Range-changing commits first (newest first), then other attributed commits."""
    ordered = []
    for commit in _all_commits(report):
        if commit not in ordered:
            ordered.append(commit)
    return ordered[:MAX_COMMITS]


def _paths(report: Report) -> set[str]:
    return {report.path} | {rename.old_path for rename in report.renames} | {line.path for line in report.blame}


def retrieve_discussions(report: Report, *, api_url: str = API_URL, token: str | None = None,
                         now=None, client: GitHubClient | None = None) -> RetrievedDiscussions:
    owner, repo = github_repository(report.remote_url)
    client = client or GitHubClient(owner, repo, api_url=api_url, token=token)
    prefix = f'https://github.com/{re.escape(owner)}/{re.escape(repo)}'
    pull_url = re.compile(prefix + r'/pull/([0-9]{1,9})')
    commits = _commits(report)
    retrieved_at = (now or datetime.now(timezone.utc)).strftime('%Y-%m-%dT%H:%M:%SZ')
    pulls: dict[int, RetrievedPull] = {}
    checked, without, notes, dropped = [], [], [], 0
    referenced: list[ReferencedIssue] = []
    if len(set(_all_commits(report))) > MAX_COMMITS:
        notes.append(f'Only the first {MAX_COMMITS} report commits (range changes first) were looked up.')
    try:
        for commit in commits:
            value = client.get(f'/commits/{commit}/pulls')
            checked.append(commit)
            found = False
            for item in value if type(value) is list else []:
                try:
                    number = item['number']
                    if type(number) is not int or not pull_url.fullmatch(item['html_url']) or \
                            pull_url.fullmatch(item['html_url']).group(1) != str(number):
                        raise ValueError
                    found = True
                    if number in pulls:
                        if commit not in pulls[number].commits:
                            pulls[number].commits.append(commit)
                        continue
                    if len(pulls) >= MAX_PULLS:
                        notes.append(f'More than {MAX_PULLS} pull requests matched; later ones were omitted.')
                        continue
                    title, _ = _text(item['title'], 300)
                    description, truncated = _text(item.get('body'))
                    state = item['state'] if item.get('state') in ('open', 'closed') else 'unknown'
                    merged = _time(item['merged_at']) if item.get('merged_at') is not None else None
                    pulls[number] = RetrievedPull(number, item['html_url'], title, _login(item.get('user')), state, merged,
                                                  _time(item['created_at']), [commit], description, truncated)
                except (KeyError, TypeError, ValueError):
                    dropped += 1
            if not found:
                without.append(commit)
        for pull in pulls.values():
            dropped += _comments(client, pull, prefix, _paths(report))
            dropped += _linked_issues(client, pull, prefix)
        candidates: dict[int, list[str]] = {}
        messages = {change.commit: change.message for change in report.changes}
        for commit in without:
            for match in _REFERENCES.finditer(messages.get(commit, '')):
                number = int(match.group(1) or match.group(2))
                sources = candidates.setdefault(number, [])
                if commit not in sources:
                    sources.append(commit)
        if len(candidates) > MAX_REFERENCED_ISSUES:
            notes.append(f'Only the first {MAX_REFERENCED_ISSUES} referenced issues from direct report commits were looked up.')
        issue_url = re.compile(prefix + r'/issues/([0-9]{1,9})')
        for number, sources in list(candidates.items())[:MAX_REFERENCED_ISSUES]:
            item = client.get(f'/issues/{number}')
            if item is None:
                notes.append(f'Referenced issue #{number} was not available.')
                continue
            try:
                if type(item) is not dict or 'pull_request' in item or type(item.get('number')) is not int or item['number'] != number \
                        or type(item.get('html_url')) is not str or not issue_url.fullmatch(item['html_url']) \
                        or issue_url.fullmatch(item['html_url']).group(1) != str(number):
                    raise ValueError
                title, _ = _text(item['title'], 300)
                text, truncated = _text(item.get('body'))
                state = item['state'] if item.get('state') in ('open', 'closed') else 'unknown'
                referenced.append(ReferencedIssue(number, item['html_url'], title, _login(item.get('user')), state, text, truncated, sources))
                dropped += _issue_comments(client, referenced[-1], item.get('comments'))
            except (KeyError, TypeError, ValueError):
                dropped += 1
    except _Stop as stop:
        notes.append(str(stop))
    if dropped:
        notes.append(f'{dropped} malformed or unexpected GitHub records were skipped.')
    if not checked:
        notes.append('No commits could be looked up.')
    return RetrievedDiscussions('github', f'{owner}/{repo}', retrieved_at, PROVENANCE, checked, without,
                                sorted(pulls.values(), key=lambda pull: commits.index(pull.commits[0])),
                                notes, referenced)


def _issue_comments(client: GitHubClient, issue: ReferencedIssue, count) -> int:
    """One last snapshot page; never imply a complete or immutable discussion."""
    if type(count) is not int or not 0 <= count <= 2**31 - 1:
        issue.comment_note = 'Issue comment count unavailable; comments were not fetched.'
        return 0
    issue.comment_count_at_lookup = count
    issue.omitted_comments_estimate = count
    if count == 0:
        issue.comment_note = 'No comments were reported at issue lookup; the snapshot may change.'
        return 0
    page = (count + ISSUE_COMMENT_PAGE - 1) // ISSUE_COMMENT_PAGE
    value = client.get(f'/issues/{issue.number}/comments?per_page={ISSUE_COMMENT_PAGE}&page={page}')
    if value is None:
        issue.comment_note = 'The issue comment page was unavailable; its description is retained.'
        return 0
    if type(value) is not list or len(value) > ISSUE_COMMENT_PAGE:
        issue.comment_note = 'The issue comment page was malformed; its description is retained.'
        return 1
    expected = f'https://api.github.com/repos/{client.owner}/{client.repo}/issues/{issue.number}'
    collected, seen, dropped = [], set(), 0
    for item in value:
        try:
            if type(item) is not dict:
                raise ValueError
            identity = item.get('id')
            if type(identity) is not int or not 1 <= identity <= 999999999999999 or identity in seen \
                    or item.get('html_url') != f'{issue.url}#issuecomment-{identity}' \
                    or item.get('issue_url') != expected:
                raise ValueError
            seen.add(identity)
            text, truncated = _text(item.get('body'))
            if not text.strip():
                continue
            comment = RetrievedComment('issue-comment', _login(item.get('user')), item['html_url'],
                                       _time(item.get('created_at')), text, truncated)
            collected.append((identity, comment))
        except (KeyError, TypeError, ValueError):
            dropped += 1
    issue.comments = [comment for _, comment in sorted(collected)]
    issue.omitted_comments_estimate = max(0, count - len(issue.comments))
    issue.comment_note = (f'Read page {page} using {count} comments reported at issue lookup; '
                          f'Omission estimate: {issue.omitted_comments_estimate} comments are not quoted. '
                          'Counts may change during retrieval; this is not a complete discussion.')
    return dropped


def _comments(client: GitHubClient, pull: RetrievedPull, prefix: str, paths: set[str]) -> int:
    """Review comments on the selected file first, then review summaries, then conversation."""
    dropped = 0
    anchor = re.escape(f'/pull/{pull.number}')
    collected: list[RetrievedComment] = []
    sources = [
        ('file-review-comment', f'/pulls/{pull.number}/comments?per_page=100', re.compile(prefix + anchor + r'#discussion_r[0-9]{1,15}')),
        ('review', f'/pulls/{pull.number}/reviews?per_page=100', re.compile(prefix + anchor + r'#pullrequestreview-[0-9]{1,15}')),
        ('conversation', f'/issues/{pull.number}/comments?per_page=100', re.compile(prefix + anchor + r'#issuecomment-[0-9]{1,15}')),
    ]
    total = 0
    for kind, path, url_pattern in sources:
        value = client.get(path)
        for item in value if type(value) is list else []:
            try:
                if kind == 'file-review-comment' and item.get('path') not in paths:
                    continue
                text, truncated = _text(item.get('body'))
                if not text.strip():
                    continue  # An approval without words says nothing to quote.
                if type(item.get('html_url')) is not str or not url_pattern.fullmatch(item['html_url']):
                    raise ValueError
                created = _time(item.get('submitted_at') if kind == 'review' else item.get('created_at'))
                line = item.get('line') if type(item.get('line')) is int else item.get('original_line')
                total += 1
                if len(collected) < MAX_COMMENTS:
                    collected.append(RetrievedComment(kind, _login(item.get('user')), item['html_url'], created, text, truncated,
                                                      item['path'] if kind == 'file-review-comment' else None,
                                                      line if kind == 'file-review-comment' and type(line) is int else None))
            except (KeyError, TypeError, ValueError):
                dropped += 1
    pull.comments = collected
    pull.omitted_comments = total - len(collected)
    return dropped


def _linked_issues(client: GitHubClient, pull: RetrievedPull, prefix: str) -> int:
    """Issues the pull request says it closes, in the same repository."""
    dropped = 0
    numbers = []
    for match in _CLOSES.finditer(pull.description):
        number = int(match.group(1))
        if number != pull.number and number not in numbers:
            numbers.append(number)
    issue_url = re.compile(prefix + r'/issues/([0-9]{1,9})')
    for number in numbers[:MAX_LINKED_ISSUES]:
        item = client.get(f'/issues/{number}')
        if item is None:
            continue
        try:
            if 'pull_request' in item or not issue_url.fullmatch(item['html_url']) or item['number'] != number:
                raise ValueError
            title, _ = _text(item['title'], 300)
            text, truncated = _text(item.get('body'))
            state = item['state'] if item.get('state') in ('open', 'closed') else 'unknown'
            pull.linked_issues.append(RetrievedIssue(number, item['html_url'], title, _login(item.get('user')), state, text, truncated))
        except (KeyError, TypeError, ValueError):
            dropped += 1
    return dropped
