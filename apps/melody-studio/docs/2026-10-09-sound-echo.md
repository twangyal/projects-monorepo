# Rhythmic echo — 2026-10-09

Tracking: [#162](https://github.com/twangyal/projects-monorepo/issues/162).

Optional track echo settings add 1–8 complete voice repeats at 0.25–4 beat intervals, with per-repeat decay 0.05–0.95. Explicit Apply/Discard reuses the retained per-track raw-field lifecycle and whole-project history/autosave. Bypass removes the optional field; legacy documents and PCM remain unchanged. Complete project and reference-document admission both validate and detach the settings. No schema-version, dependency or reference-asset change is needed.

Synthesis reuses each complete oscillator/filter/envelope waveform and adds delayed placements with decay^tap gain. Different echoes remain independent even when their dry voices group. Full and aligned stem output includes the complete echo/release tail, including silent muted endpoints for alignment. Existing whole-mix peak limiting and the 40-million-frame allocation refusal remain active. Sections and comparison windows retain their exclusive bounds. MIDI carries its original notes/programs without custom echo.

## Evidence

- Five domain tests initially failed for missing retained settings and delayed output. After implementation, complete document admission separately exposed an unknown-track-field refusal; its optional-field boundary was updated. All five now pass.
- Independent nonoverlapping tap locations and gain ratios, overlapping filtered/enveloped sums, unrelated tracks, muted silence, full tail length, loud peak limiting, stem/backing retention and allocation refusal are verified. Malformed/nonfinite/accessor settings reject; no legacy fields are introduced.
- Four focused native browser cases pass. Actual full WAV matches a direct sine/envelope/tap oracle without using the product's renderer or lookup table (maximum tolerance two PCM16 units). Track WAV matches that quiet isolated mix; section PCM is the exact exclusive crop. Unapplied drafts preserve previous WAV, and bypass restores its original bytes. MIDI and original reference assets remain exact.
- Actual native AudioBufferSourceNode starts are observed without replacing the audio APIs: composition and solo buffers have the expected rate, channels, frame count and sampled PCM, including the tail. This verifies scheduled data, not physical audio output or subjective musical quality.
- Complete backup, Undo/Redo, autosave/reload and track duplication preserve applied settings. Invalid drafts survive track selection; Discard restores committed fields. A pointer Apply keeps an unrelated focused title uncommitted; keyboard Apply succeeds after resolving that draft.
- The 390px initial screenshot exposed compressed half-width effects fieldsets. They now span the full mobile settings grid; final native layout verification is recorded with the final gate.

Local full browser gate: 185 passed (2.6m), exit 0, before the final mobile-width CSS improvement. Final-source `npm run check` passes lint, typecheck, all 362 unit tests and production build. The four focused echo cases are rerun after the CSS change, including an explicit full-width fieldset assertion and a new inspected screenshot. Exact-published-head hosted gates are recorded in issue #162 after their actual outcomes. Native tests use CPU Chromium 153; physical device and musician-quality acceptance remain unverified. This is finite mono echo, not a stereo delay, reverb, live-input effects or routing system. Melody Studio remains ACTIVE toward the full DAW destination.
