# Explicit radio selection — #308

The extension's real-website runtime now accepts explicit radio-button selection, distinguishes it from ordinary activation and checks the retained result. No dependency or permission change. Speech and typed entry use the same deterministic interpreter and confirmation/cancellation lifecycle.

## Verification

- Observed the new interpreter tests fail on missing intent and the native browser flow fail on missing action before implementation.
- All 203 Node tests pass. Syntax and test-extension build pass. Fixed instruction baseline remains 120/120; the two held-out sets remain 34/50 and 18/50, with zero unsafe results and explicit abstentions. These scores do not evaluate real speech or new radio phrases; separate tests exercise those phrases.
- Fresh independent read-only review reproduced two defects: hidden selected widgets could report success, and a custom radio could move to another radiogroup/form while retaining its old captured identity. Added failing browser regressions, then guarded visibility across frame/shadow ownership and captured group/form ancestry. Website-owned state is still never assigned or retried.
- Final focused browser run passes all48cases across desktop, narrow, short and compact-boundary viewports (21.8seconds). Includes native grouping/idempotence, ARIA state, canceled/reverted/hidden/reparented controls, locks, focus/identity changes, clarification/confirmation, shadow/frame ownership and retired feedback. Canonical CI remains pending at this implementation commit.

## Local limitations and failed attempts

The available local Chromium143 serverless build cannot start MV3 extension service workers. The first full attempt timed out setting up the unchanged extension worker fixture; it was stopped. A second full attempt excluding extension.spec.js was stopped after the unchanged `twenty maximum session drafts retain full text and refuse a new record without losing fields` case exceeded its existing20-second timeout. The authored radio checks themselves passed in that attempt. Neither aborted run is a full-suite pass. Canonical CI uses full Playwright Chromium and is required for complete extension/browser acceptance; no test timeouts or gates were loosened.

## Limits

Explicit `select/choose/pick … radio button` phrases target radios only. Bare `choose Express` keeps existing behavior. Custom controls require literal binary aria-checked; selecting a target does not certify the website's entire custom group. Site effects scheduled in later tasks can change state after feedback; verification drains microtasks, not all future website work. Physical microphone/webcam quality, broader real-site usability and intended-user acceptance remain open in #132. Gaze stays ACTIVE. Project #8 stays skipped.
