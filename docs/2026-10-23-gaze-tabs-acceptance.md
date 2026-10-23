# Gaze website-tab selection acceptance — #312

Source commit: `d5bf85f5d66199563a073e6783938534569485ab`.
[Canonical run](https://github.com/twangyal/projects-monorepo/actions/runs/39994117454) passed all three shards: 208 + 210 + 202 = **620 native browser cases**, including strict-CSP installed-extension selection at all four viewports. All shards also passed **205 Node tests**, syntax lint and extension build. The unchanged frozen instruction suite remains 120/120, 34/50 and 18/50 with zero unsafe actions; this is not a physical speech or new-phrase evaluation.

Fresh independent review found no blocking defects; its request for real extension injection coverage was implemented and passed canonical Chromium. Local focused tests passed 44/44 after correcting an ambiguous-matching fixture. The scorer regression first exposed missing radio/tab action classification; the fixed scorer and unchanged frozen evaluation passed. See the [implementation receipt](../apps/gaze-navigator/docs/2026-10-23-website-tabs.md) for retained failures and local portable-browser limits.

Explicit select/choose/pick tab instructions now verify single-selection state, retain site-owned focus/click activation and stop delayed clicks after cancellation. This milestone does not certify panel loading, browser chrome control, arbitrary delayed website effects, or physical gaze/speech acceptance. Gaze remains ACTIVE; #132 remains open and project #8 remains skipped.
