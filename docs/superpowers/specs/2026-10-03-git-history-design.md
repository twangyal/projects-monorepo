# Local Git history evidence explorer

Project #4, issue #11. A useful offline developer tool that investigates a committed file range and renders its source, blame, relevant changes, and commit-message evidence in a portable report. Autonomous architecture and execution are authorized. No model, paid service, network lookup, or repository mutation is needed. This is evidence organization, not a claim of semantic AI interpretation.

## User flow

Run `python -m git_history explain --repo PATH --ref HEAD --file src/example.py --lines 20:45 --format html --output report.html`. Default output is HTML on stdout; JSON is available for automation. Open the standalone report in any browser, navigate its source/attribution/timeline/rename anchors, and inspect exact quoted messages and patches. Requested refs resolve once to a commit ID. All results refer to that committed revision; working-tree edits are excluded. Existing output files are not overwritten without `--force`; reject output inside any Git metadata directory even with force.

## Data and evidence

`git_history/model.py` defines the shared dataclasses. `reader.inspect_repository(repo: str | Path, file: str, start: int, end: int, ref: str = 'HEAD', max_commits: int = 20) -> Report` produces them. Show the selected source with original line numbers and each line's blamed commit/original path/line. Trace range-changing commits via Git's `log -L` and show exact patches and messages. Include whole-file rename evidence where Git identifies it. Quote messages as author statements, never established intent; explicitly state that intent is unknown without such evidence and PR/issue discussions have not been fetched.

Use self-contained links for every available evidence object. Recognized HTTPS/SSH GitHub/GitLab origins can add credential-free HTTPS links. Unrecognized, local, malformed or credential-bearing remotes must not leak secrets into reports; sanitize before returning any remote value. All source, messages, names and paths are untrusted text and escaped in HTML. No scripts, external fonts, images or resources; restrictive CSP.

## Safety and completeness

Python >=3.11 plus Git >=2.30; standard library at runtime. Use argument arrays, never a shell. Resolve refs with `rev-parse --verify --end-of-options REF^{commit}`, then use object IDs. Reject absolute/traversing file paths; exact literal-path lookup with `ls-tree -z`. Blob IDs avoid revision/path ambiguity. Disable external diff/textconv/pagers/fsmonitor and optional locks. Do not checkout, fetch or write Git configuration.

At most 200 selected lines, 50 range commits, 512 KiB source blob, 2 MiB output per command, 10 seconds per command, 8 MiB serialized report. `GitRunner(repo: str | Path, timeout: float = 10, max_bytes: int = 2_097_152).run(*args: str, max_bytes: int | None = None) -> bytes` enforces bounded subprocess reads and raises `GitError`, `GitTimeout`, or `GitOutputLimit`. Kill and reap on limits. Refuse binary (NUL-containing), non-UTF-8 and missing source explicitly; malformed revisions/ranges return actionable errors. Treat line tracing/rename gaps as warnings while retaining valid blame evidence. Mark history truncation, shallow history and merge/rename heuristics honestly; never imply full semantic lineage.

## Verification

Temporary fixture repositories cover edits, insertion-shifted blame, roots, renames and rename+edit, merges, shallow history, special filenames, invalid refs/ranges, binary/oversized blobs, limits and disabled external textconv. Runner tests cover timeout/output caps and stderr capture without shell execution. CLI/report tests cover status codes, JSON contract, HTML escaping/anchor resolution, portable styles, output protection and the end-to-end report. A new independent CI workflow runs only this app. Excluded projects stay untouched.
