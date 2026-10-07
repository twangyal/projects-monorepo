# Instrumented Chromium 155 timeout recurrence — #128

The first instrumented recurrence is retained from PR run37569571709,
postfix-maximum job112624908139 at04ead28ae30c465acc6fb48be3a667aabd523098.
The Shot tree is byte-identical to b08326ad before this documentation commit.
Browser: full Chromium155.0.8059.12. The original maximum fixture oracle and all
input/output gates are unchanged. No retry or timeout increase was used.

The complete original11,554,385-byte archive retains SHA256
`a6137efd2434bd48dfd36aa6cf21c3d0c63f04694d14c3025458243a6bc03751`
through full browser restart. Actual sixty-second audiovisual export then fails.
Twenty bounded observations retain visible/focused encoding: progress grows from
0 to0.9816666666666667 (58.9 seconds of authored render time) at
70062.997ms. At75066.547ms the application reports “Export timed out. Try a shorter
film.” with Export re-enabled; the download waiter expires at95011.170ms. No page
errors/external requests occur. DOM progress is not a count of completed encoded frames. The browser stays connected until harness cleanup
and exits normally. This is distinct from the older Chromium153 SIGTRAP.

This establishes the application deadline expired before publication. It does
not identify which render/encoder/muxer operation consumed the budget, prove that
the earlier uninstrumented failure had the same cause, or establish peak memory,
universal browser compatibility or hardware performance. The failed audiovisual
file is absent; no frame/PCM acceptance is claimed for this attempt.

Next investigation: keep the frozen fixture,70-second product budget and95-second
download gate; measure bounded render/addVideo/addAudio/finalize stage timing to
separate rendering throughput, native encoding backpressure and finalization.
Do not extend gates or retry away this failure. The standard configured maximum
gate passes separately; its browser/backend is not full Chromium155.

Raw first-failure verification and browser log are retained verbatim. Provenance
records their hashes and the1,032,322-byte original ZIP SHA256. Binary fixture and
archive files are excluded from this text receipt; fixture oracle/input hashes
remain in verification.json, and the CI artifact URL is recorded in #128.
