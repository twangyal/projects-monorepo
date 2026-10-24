# Repeated lyric-word correction — #317

Autonomous inline execution. Intent: correct repeated recognition mistakes with inspectable literal replacements across current cues. Choose an explicit case-sensitive tool and live before/after preview over regex or inferred replacements. Preserve the automatic-recognition source and require separate Save. The whole current cue graph and proposed text must satisfy existing limits; invalid cue timing is corrected before batch replacement.

- [x] RED pure literal/Unicode/full-proposal/limits/no-op tests; implement bounded replacement in existing cue-edit module.
- [x] RED native desktop/phone tool; live complete preview, atomic Apply using owned edit/history paths, exact unrelated raw timing/title/paste preservation and utility reset.
- [x] TypeScript/static/build and focused native checks, independent review, README/roadmap and connected source checkpoint. Complete browser/Python gates recorded separately.
- [x] Canonical gates, final receipt and issue completion.

Review focus: literal replacement strings such as $&; no-op/history/playback preservation; empty resulting cues and whole-graph quota refusal; stale preview after edits; unsaved versus saved lyrics. No new dependency/provider. #241 quality/effort acceptance stays open; #8 skipped; no PR.

Final source `ac261785`: canonical run40081186134 passes206 Python/154 TypeScript/all139 browsers and static/build gates. Fresh isolated local browser cohort passes139/139 in6.8minutes. [Final receipt](../../2026-10-24-karaoke-word-replacement-acceptance.md) retains the local205/206 Python resource-test failure, original137/139 trace collision and the separate corrected cohorts. Karaoke stays ACTIVE; #241 stays open; #8 skipped.
