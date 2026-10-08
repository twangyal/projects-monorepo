# Resonant low-pass sound shaping (#155)

This milestone adds subtractive sound design toward the ACTIVE full-DAW destination. It does not establish full DAW completion or musician evaluation.

An optional track filter stores cutoff (20–10,000 Hz) and resonance Q (0.5–8). Apply is one history/autosave edit; bypass removes that optional field. Legacy tracks retain their exact unfiltered render arithmetic and project shape. Complete reference documents, saved compositions and duplicated tracks use the same detached validation. Raw filter drafts are per-track, explicit and protected from unrelated field commits.

Each oscillator voice uses a zero-state two-pole low-pass before its linear amplitude envelope, following the [W3C Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/). Settings participate in both identical-note grouping and waveform reuse. No post-track buffer is allocated. The effective cutoff is capped at 45% of the render sample rate; amplitude release length and the existing full-mix limiter remain unchanged. MIDI has no custom filter representation. Filter automation, filter envelopes, audio effects buses and routing are unfinished.

## Verification before publication

- Five new model/DSP cases failed against the old implementation, then passed. They check strict shape/ranges/accessors, detached complete-document retention, independent complex frequency-response magnitudes for four pitches/four Q values, differently filtered same-note grouping and finite rendering at 8 kHz.
- All 353 unit tests, lint, TypeScript and production build passed.
- Six focused native Chromium sound/filter/envelope cases passed. Actual downloaded WAV PCM matches a separate direct-form-I sine/filter/envelope oracle within two signed-16 sample units. Unapplied drafts leave bytes unchanged; bypass restores original WAV bytes. Complete project downloads preserve references/assets; Undo/Redo, reload and duplication retain applied settings. A 390px keyboard/raw-field case has no horizontal overflow.
- Two first native test failures were fixture-observation mistakes: duplication inserts immediately after the selected track, and clicking a project-download button intentionally blurs/commits the title. The assertions were corrected to inspect the actual inserted copy and durable storage without changing focus. Production behavior was not relaxed.
- Independent read-only review found no Critical/Important blocker. Its minor shared guard wording observation was corrected.

The full 178-case browser suite was still running and hosted verification was pending at this implementation checkpoint; their final outcome is recorded in GitHub issue #155. The local browser was Chromium 153; hosted CI uses its configured Playwright Chromium. No broader browser or listening-quality claim is made.
