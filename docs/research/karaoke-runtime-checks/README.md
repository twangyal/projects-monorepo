# Local runtime RSS observation — 2026-10-23

Verification follow-up for #309, frozen application source `2e72ef70f76d580521564471e41be26c4bc5612c`. This is a diagnostic wrapper around the unchanged complete service suite, not shipping behavior or a replacement gate.

Run from `apps/karaoke-studio`:

```sh
python3 ../../docs/research/karaoke-runtime-checks/rss_observe.py
```

It records only the RSS test's own child PID, monotonic observation time, original monitor return and a second bounded `/proc` status read. It never changes the monitor return. Output goes to `/tmp/karaoke309-rss-observations.json`; the committed capture and SHA-256 manifest preserve this observation.

All 206 tests ran in 86.126 seconds; only `test_subprocess_rss_limit_is_enforced` failed. Across 99 observations spanning about two seconds, the unchanged monitor returned zero and the independent `/proc/480/status` reads all failed with `FileNotFoundError`. The real `_run` loop still observed a live child and eventually enforced its existing two-second timeout. This establishes that its child's status path was unavailable to this local process. It does not establish whether PID namespaces, procfs mounting or another runtime mechanism caused that mismatch. An isolated earlier test passed, but that cannot establish reliable procfs enforcement here.

No production or test threshold was changed. Hosted full Linux CI remains the acceptance environment for the service's original memory-enforcement test. The capture is diagnostic, not a demonstration of effective memory enforcement or an application regression fix.

## Native audition baseline

The fixed three-case cohort replays `automatic review listens to captured recognized timing while invalid raw corrections remain untouched` against pre-insertion source `45a7fbb82130177a69c964333a526d28cd39105d` (same Karaoke code as before #309). All three fail the unchanged six-second native pause predicate in local serverless Chromium143. The log and exact command are retained with hashes. No repetition-until-pass, timer extension or production change was used. This reproduces the failure before insertion; it does not identify the native audio/runtime cause or establish physical playback quality. The later reviewed-interval case passed in the fresh final-source full run despite failing in an earlier broad attempt; both outcomes remain recorded in #309's receipt.
