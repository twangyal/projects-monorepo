# Git History supplied discussion context

Issue #17 extends the existing offline explanation flow. The user authorizes autonomous design and implementation. The app worktree was clean before work. The issue body supplied by the integrator is the source of truth; no issue, comment, commit or push is created by this implementation.

## Behavior and data

`explain --context FILE` optionally reads a local UTF-8 JSON sidecar after resolving the existing report. The file contains exactly `schema_version: 1` and `entries`, an array of up to 50 objects. Each object contains exactly `commit`, `source`, `url`, `author`, and `excerpt`. `source` is a supplied human-readable label (for example, `Pull request #42`), not a verified source classification. Source and author are nonempty strings of at most 200 characters; excerpts at most 4,000; URLs at most 2,048. Text is literal, valid Unicode; NUL and unsupported control characters are rejected. Files must be regular files of at most 256 KiB. Duplicate JSON keys, nonstandard constants, unsupported versions and unknown fields fail before output publication.

Commit IDs must be exact lowercase 40- or 64-character hexadecimal IDs already present in the report's selected revision, blame, changes, or renames. Abbreviations and refs are not resolved. Any unrelated/stale ID rejects the entire sidecar; matching an ID does not verify an excerpt or its relevance. A report of another revision can reuse context only when the entry's full ID is still represented. No context is silently dropped.

URLs must be credential-free HTTPS links on `github.com` or `gitlab.com`, with no port, query, escaped path, whitespace or user information. Supported routes are GitHub `OWNER/REPO/pull/N`, `issues/N`, `discussions/N`, and GitLab `GROUP[/SUBGROUP]/PROJECT/-/merge_requests/N` or `issues/N`. Known GitHub comment/review fragments and GitLab `note_N` fragments are allowed. No URL is fetched and remote ownership is not claimed. All labels, authors and excerpts remain explicitly unverified supplied data.

## Integration and compatibility

Add `ContextEntry` to the shared model and a focused `context.py` loader/validator. `load_context(path, report)` returns validated entries. Renderers gain an optional context argument; omitted context leaves the prior report schema and HTML unchanged. JSON adds a separate `supplied_context` object containing its schema version, explicit unverified provenance note, and entries with commit evidence anchors. HTML adds a separate escaped supplied-context section and navigation link. URLs remain optional-to-follow browser links, using noreferrer/noopener; there are no external assets or scripts. A selected-revision-only entry receives an anchor on the existing revision display, rather than invented commit details.

Validate context again at renderer boundaries so direct callers cannot introduce unsafe URLs or unrelated links. Existing report limits, output-file protection and atomic publication still apply. On any sidecar failure, CLI exits 2 without stdout/report publication and preserves existing files, including with `--force`. Error messages name the field/entry and remedy without echoing excerpt or credential-bearing URL contents. Source paths are not embedded as provenance.

## Verification

Real fixture CLI tests cover successful JSON/HTML imports, function selection, all four commit evidence sources, stale/unrelated and abbreviated IDs, malformed/versioned/duplicate/oversized input, unsafe links, Unicode/control bounds, local file safety, escaping and anchor resolution. Verify reports are unchanged when omitted, original evidence is unchanged when supplied, and failure preserves output atomically. Run the complete app unittest suite, Ruff and compile checks; inspect a portable report in a browser if available. README documents the complete local-file schema, command and limits. No dependencies or repository-wide changes are required.
