# Karaoke rehearsal speed implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rehearse difficult lyric passages slowly without changing song timings or exports.
**Architecture:** Fixed native rates0.5/0.75/1 via the existing HTML audio element. Practice snapshots its admitted speed and remains owned only while the rate is unchanged. Existing ratechange retirement stays intact. Pitch preservation is requested through the browser API, not evaluated acoustic quality. Player speed is session-only and defaultPlaybackRate retains UI choice across track loads.
**Tech Stack:** Existing TypeScript/Node24/Playwright/Python service. No new dependency/schema/workflow.
**Spec:** #328 and docs/PRODUCT_DIRECTION.md section6. Owner authorizes independent noninteractive product choices and inline execution.

## Global Constraints

KaraokeACTIVE/#241open/#8skip/noPR. Speed never changes editor/raw fields/title/paste/history/song bytes/exports. Keep normal1x manual timing capture, stop staged capture on speed change. Retire practice/audition before changing rate; no autoplay from speed changes. Preserve paused playhead; different clip resets1x. Same-clip track changes retain chosen speed. Unsupported external rates cannot start practice. Native quality and non-sample-accurate repeat remain explicit limits.

## Approaches and decision

Native fixed-rate playback is chosen for bounded rehearsal with existing source ownership. Arbitrary text rates add invalid/low-quality states without demonstrated benefit. Offline time stretching introduces processing/storage/export semantics not needed for this listening feature. These are executor choices under the user's explicit noninteractive autonomy, not owner-prescribed architecture.

## Review Focus

- Queued old play/seek after speed change cannot revive rehearsal.
- Track load resets native playbackRate; explicitly chosen default must survive same-clip changes.
- Slow listening must not admit inaccurate timing-capture workflow or mutate saved lyric data.
- Pause/seek/stop/repeat endpoints use media seconds at any admitted speed, not wall time.
- Phone keyboard control and unsupported externally changed rates remain understandable.

## Task1 — bounded native slow listening

Files: src/practice.ts (shared rate admission), src/practice-controller.ts (speed snapshot/status), src/main.ts (visible speed utility/reset), tests/practice.test.ts and tests/rehearsal-speed.spec.ts; README/docs/roadmap.
Interfaces: isRehearsalSpeed(value: unknown): value is 0.5 | 0.75 | 1; PracticeController.start remains unchanged, snapshots actual admitted media rate internally.
- [x] Baseline159TSunits; modelREDmissingexport→14practiceGREEN; nativeREDabsentcontrol.
- [x] Add shared fixed rate guard; controller snapshot/validity/status; guarded utility sets defaultPlaybackRate/playbackRate/preservesPitch, retires current owners, resets on new clip.
- [x] Final160TSunits/lint/types/build;5focused native cases36.4s. Native actual-clock progress/repeat/gap/pause/stop, track continuity, raw/Redo/SRT, timing guard, clip reset, phone/automatic-review and stale callbacks.
- [x] Fresh review: oneImportant default divergence repaired nativeRED expected1/got0.5→GREEN; noCritical/Minor/no rereview. Final160TSunits/lint/types/build and6focused native37.0s. Source commit via connected GitHub tools.
- [x] Observed exact-source canonical206Python/160TS/all149browser, Ruff/compileall/lint/types/build pass. Final local149browser7.8min pass; root acceptance/receipt retain interrupted runs and prior local limitations. Close#328 as bounded software milestone; KaraokeACTIVE/#241open/#8skip.

## Ledger

Base738ba4b. Pre-flight: one task, no cross-task interfaces. Prior#327 accepted canonically; lost local browser result stays unknown. Cloud skill helper scripts unavailable as files; this durable plan holds the ledger. All code work is isolated in linked detached karaoke-speed-328 worktree, not stale main. Native browser wrapper uses existing portable Chromium binary; report runtime exactly when observed. No physical pitch-quality or reduced correction-effort claim.

Fivefocused nativecases pass36.4s with actualhalfclock(.35..65 fixedratio),2repeat boundaries/gap, all3tracks/endpoints, pausedplayhead, raw/Redo/SRT/audiohash, timingnormalguard,phonekeyboard/newclipreset,automaticreview and delayed nativeplay completion retirement. Full148case local run started; freshreview pending.

Fresh review: noCritical/Minor; oneImportant native/controldefault divergence. NativeRED reproduces 1 expected versus0.5 observed after native1x then trackload. Singlefixpass synchronizes supported native speed into defaultPlaybackRate and repairs default even for an already-current choice. GREEN focused/full suites pending. No rereview.
Final Ruling: browser pitch preservation and acoustic quality remain unevaluated; APIrequest is delivered but cannot establish sound quality. Wrong assumption would overstate fidelity, so no fidelity claim.
Final Ruling: real-song recognition/alignment quality and correctioneffort remain#241, not inferred from synthetic rehearsal. Wrong inference would overstate product completion; KaraokeACTIVE.
Final Ruling: physicalphone/screenreader/Safari/Firefox are unverified; Chromiumviewport/keyboard tests cover only their measured environment. No cross-platform acceptance claim.
Final Ruling: no newlyrendered slow-choiceMP4 in this review; export isolation is supported by unchanged export paths and exact saved SRT/sourceaudio tests, plus full existingvideo gates when observed. No fresh speed-specific renderedvideo observation claimed.
Final Ruling: full/localcanonical gates are recorded separately onlyafterobservation; focusedsuccess doesnot establish whole-suite acceptance. Unrelated existing behavior is outside this milestone; no regression closure claim.

Final: fixed native/control default divergence — native player speed changes remain selected across same-clip track loads RED→GREEN;160/160units/lint/types/build and6/6focused native37.0s pass. Earlier full148case run intentionally interrupted(exit130) after46observed passes before rebuilding for the review fix; no complete/full pass claim. Fresh final149case local/canonical gates follow.

Post-review observation directly addresses export isolation: selected0.5x native export passes onecase5.4s, independently decoded6second H264/AAC/144frames/12boundarypixels and unchanged saved/raw/SRT/all3audio hashes. Receipt retained in root docs. Fresh final149case local suite passes7.8minutes,exit0. Canonical job121117808882/run40176366602 still in progress; no full acceptance claim yet.

Task1 complete: source dcefdbe; fresh whole-suite160TS/static/build and149native local7.8min/canonical7.0min pass. Canonical206Python83.949s includingRSS. Root acceptance supersedes pending checkpoints. Fresh reviewoneImportantfixedRED/GREEN/noCritical/Minor/no rereview; post-review actualMP4 observation recorded separately. Owner authorization integrates to main via connectedGitHub, noPR.
