# Observed test-harness failure

The strengthened native photo assertion initially failed at `page.evaluate` with `TypeError: Failed to fetch` when fetching a downloaded PNG through a `data:` URL. Production CSP disallows that request. The assertion now uses the same downloaded PNG bytes in a Blob and decodes it with the native image decoder. No production behavior, security policy, pixel threshold, timeout or expected result changed. The original terminal output was overwritten during a browser-launch retry; this record is a summary, not a verbatim retained log.
