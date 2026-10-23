# Explicit radio selection implementation plan

> Native execution under the owner's noninteractive autonomy instruction.

**Goal:** Select and verify a website radio choice through the extension.
**Architecture:** Add a deterministic `select-radio` action for explicit radio-button phrases. Reuse clarification, consequential confirmation and stale asynchronous result retirement. Use website-owned clicks, with no assignment or retry, and verify after website microtasks.
**Stack:** Existing JavaScript modules, MV3 extension, Node tests and Playwright Chromium.
**Design:** Issue #308. Generic activation remains unchanged; custom ARIA state must be binary. Do not invent custom-group semantics. Native grouping stays browser-owned. Revalidate target identity, availability and focus before click and retained availability/identity/state afterward. Already-selected targets emit no click.

## Review focus
Ambiguity must retain the intended action. Confirmation must not activate a changed target. Focus handlers must not redirect a click. Website cancellations/reversions must not report success. Open shadow roots and same-origin frames must retain ancestor restrictions.

## One coherent task
- [x] Add interpreter assertions for named, deictic, ordinal, ambiguous and unsupported explicit commands. Observe RED before implementation.
- [x] Add actual-browser cases for native grouped selection, idempotence, custom ARIA microtasks, cancellation/reversion, locks, focus/identity changes, stale follow-ups, shadow/frame targets and confirmation. Observe RED.
- [x] Add interpreter intent, controller dispatch/confirmation, DOM action and identity snapshot, plus concise overlay guidance. No new dependency.
- [x] Run Node, syntax/build, instruction evaluation and full browser suite including extension tests; inspect failures.
- [x] Obtain fresh read-only review, resolve findings with regressions, update README/roadmap/evidence, commit via connected GitHub tools and close #308 only with verification recorded.

Final canonical source 45a7fbb passes 203 Node and all 572 full Chromium browser cases; root acceptance receipt retains local failures and physical-use limitations.
