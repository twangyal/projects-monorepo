# Stock Notebook native terminal outcomes — issue #120

The saved notebook is one complete serialized record. A failed request setup or
store close must not release its ordered operation before native rollback. If a
native commit already completed, close must report that committed outcome rather
than implying that the old record survived.

Keep the existing per-database queue, portable format, operation deadlines and
connection ownership. Install abort and complete handlers before submitting any
request. Record sanitized setup/cancel failure and wait for native terminal
delivery whenever a transaction exists. An abort that throws because completion
already won leaves the original completion handler responsible for the outcome.
Calls admitted after close still fail before opening another connection.

1. Preserve three independent native RED cases: admitted put followed by a
   synchronous throw, active-write close with delayed abort delivery, and close
   delivered between native commit and the application completion callback.
2. Make the narrow storage change; retain exact original literal notes,
   watchlist/comparison and source data after rollback; verify another instance's
   queued read and retry.
3. Run the complete unit, lint, type/build and native browser gate. Review the
   patch independently, publish on Astra without overwriting concurrent work,
   and record the exact source CI before closing the issue.

This fixes terminal reporting and ordering. It does not introduce cross-tab
saved-copy conflict protection or change the notebook format.
