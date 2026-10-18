# Binary ARIA checkbox and switch state — issue #291

Explicit check/tick and uncheck/untick now support available custom role=checkbox/switch controls with exact aria-checked=true/false. An already satisfied request sends no events. Otherwise focus is validated and one ordinary website click runs; no ARIA attributes or synthetic input/change events are assigned. The result is observed after the click microtask queue drains. This is immediate state observation, not a wait for network or arbitrary later timers.

Connection, role, locks, focus ownership and binary state are rechecked. Missing/mixed/invalid state, native non-checkbox inputs, links and form submit/reset buttons refuse. Ambiguity and consequential confirmation still apply. New commands, cancel, pause and stop retire old feedback. Assisted target matching flattens the action's final acknowledgement so the overlay sees its result.

Local Node verification: 195 tests, syntax lint and extension build. Local portable Chromium 143.0.7499.0 passes 60 focused real DOM cases across four viewports; hosted full-suite and injected-extension results are recorded separately after CI finishes. No physical microphone, webcam or intended-user acceptance is claimed.

Meaningful RED evidence includes unsupported custom states, fabricated false discovery state, nested click-microtask reversal producing false success, and assisted matching losing its final acknowledgement/cancellation. Tests retain native checkbox coverage and add custom state, focus races, shadow/frame locks, cancellation, website event ownership, and real injected extension coverage.
