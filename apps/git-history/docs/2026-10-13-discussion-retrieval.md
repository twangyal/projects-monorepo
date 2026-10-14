# Pull-request discussion retrieval — issue #222

## Intended outcome and gap

The project's purpose is to explain how **and why** code evolved by tracing it through commits, diffs, pull requests and available discussions. Before this milestone, Git History organized local Git evidence and quoted commit messages. Discussion entered a report only when a user pasted excerpts in by hand, and the README stated that PR discussions were not fetched. For most real changes, the reasons live in the pull request: its description, reviewers' questions and the issue it closed. The tool could not reach them.

This milestone retrieves that discussion on request and keeps the project's evidence standard: quoted, linked, bounded and labelled as unverified participant text.

## Design

- **Opt-in only.** Use `explain --fetch-discussions` or the workbench checkbox. Without either, no network access occurs, and JSON and HTML reports are unchanged.
- **Scope.**
  - Only commits shown in the report are looked up: range changes first, then other attributed commits, at most 12.
  - `GET /repos/{owner}/{repo}/commits/{sha}/pulls` finds associated pull requests, including squash and rebase merges.
  - For each pull request (at most 8), the tool reads:
    - review comments, keeping those on the selected file or its earlier paths;
    - reviews with written bodies;
    - conversation comments (up to 30 kept in total, with the remainder counted);
    - up to 3 same-repository issues it says it closes.
- **Validation.**
  - Every `html_url` must point at this repository's pull request, comment, review or issue on `https://github.com`. Anything else is dropped and counted.
  - Text is limited to 4,000 characters, with truncation marked. Control characters are removed.
  - Responses are capped at 2 MiB, and redirects are not followed.
  - The API address is fixed to `https://api.github.com`. A loopback address is accepted only for tests.
- **Failure behaviour.** Rate limits (429, or 403 with no remaining quota), 401/403 refusals, other errors, timeouts and unreadable replies stop further lookups. Earlier results are kept, and the report says what was skipped and how to fix it (`GITHUB_TOKEN`). A 404 on a lookup means "none". Without a `github.com` origin the command refuses (exit 2).
- **Budgets.** Each request has a 15 s timeout, and retrieval has a 60 s overall limit. In the workbench, the job's cancellation and 45 s budget are checked before each request, and request timeouts never exceed the remaining budget.
- **Credentials.** If `GITHUB_TOKEN` is set, it is sent as a bearer token to the API only and is never rendered.
- **Report.**
  - The JSON adds `retrieved_discussions` and `synopsis.discussions`.
  - The HTML adds a numbered *Retrieved pull-request discussion* section. Review comments on this file come first and are highlighted, followed by reviews and conversation, and then closed issues in collapsible panels.
  - The synopsis adds a summary with each description's first paragraph, and timeline commits link to their pull request.
  - The intent note, the evidence note and the limits text change to say that GitHub was contacted and that the quoted text is not verified. The reader's "PR and issue discussions were not fetched" completeness note is rewritten so it stays true.

## Verification (local)

- **Python.** `tests/test_discussions.py` has 8 new cases. A loopback fake (`tests/fake_github.py`) implements the documented response shapes, and tests run the real CLI against real Git repositories. They cover:
  - no contact without the flag;
  - description, file-scoped review comments, skipped empty approvals, and conversation and closing-issue retrieval;
  - API version headers;
  - token use without leakage;
  - escaping and HTML anchors;
  - dropped foreign links and malformed records;
  - partial results on rate limits and 401s;
  - text and comment bounds;
  - GitHub-origin and API-address enforcement;
  - the workbench request field.
- **Full suite.** `python -m unittest discover` passes 365 tests (26 expected optional skips). ruff and compileall pass; Node passes 18 tests and ESLint.
- **Browser.** `tests/browser/discussions.spec.js` runs the real workbench against the fake:
  - no section until the box is ticked;
  - then the quoted section, the timeline link, the synopsis, and hostile text inert;
  - both downloads carry the discussion.

  The full browser suite passes 52 cases, with 1 optional native-parser case skipped.
- **Live check.** Against `twangyal/projects-monorepo` itself, through this environment's authenticated GitHub proxy, a report on `apps/color-context-lab/src/model.ts` lines 60–70 looked up 2 commits in 2.7 s. It found merged PR #200 for commit `a3c7d90`, with its description, one conversation comment and closing issue #199. The other commit had no associated pull request, and the report says so.

## Limits

- GitHub only. GitLab merge requests are not retrieved, though supplied-context links still accept them.
- Pull requests are found through GitHub's commit association. History rewritten after merging, or commits only referenced in text, may not match.
- At most 12 commits, 8 pull requests, 30 comments per pull request and 3 closing issues per pull request are retrieved. Discussion in linked external trackers is not followed.
- The tool quotes; it does not summarize or judge relevance beyond the file match for review comments. Model-based synthesis remains a future option and would need a no-cost provider.
