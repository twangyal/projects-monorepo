# Multi-point volume automation (#197)

The revised DAW destination needs more than one track fade. Retained volumeCurve adds1–64 sorted finite beat/level pairs with linear interpolation and held endpoints, multiplying track volume and a separately enabled volumeRamp. The shared voice renderer evaluates song-time gain throughout sustained notes, filtered envelopes, releases and echo placements. Identical voices with different curves retain separate placement gain. Curves do not extend audio; existing peak/frame budgets remain.

The editor shows1-based song beats and a committed SVG graph. Apply/Discard separate raw multiline text from playback/files; strict validation is atomic. Complete schema/model/reference documents retain curves, references and other tracks. Curves stay anchored during section transforms; continuation audition shifts them with equivalent initial/endpoint gain without adding a65th point. MIDI retains its original representation and omits the custom curve.

## Verification and first failures

Node24 gate:409units, lint, TypeScript and production build pass. Official Chromium153.0.8010.12 full production suite:219pass, including five new curve cases. Original independently authored notes/reference PCM prove exact backup/history/reload, saved-copy download/open, portable recovery, unchanged reference bytes and invalid replacement refusal. Actual WAV samples follow a four-point piecewise gain within2PCM16counts of dry audio times an independent analytic curve. Track stems and section crops agree; actual Play/Solo buffers agree within1PCM16count.390px keyboard Apply and focused raw-name protection pass; fieldset screenshot is readable without horizontal overflow.

Initial unit/native failures showed absent API/UI, missing continuous gain and lost continuation automation. A first native raw-name guard assertion used a later Download click to inspect RAM, itself blurring/committing the field; corrected the read-only durable oracle without changing implementation guards. A graph regression then reproduced stale display after Apply; explicit post-settlement redraw fixed it.

Independent review identified tiny values displayed in exponent notation while the parser admitted only decimals. Review also exposed one-based beat floating-point cancellation. New failing regressions now pass with shortest-decimal expansion and decimal±1 via bounded BigInt arithmetic before Number conversion. Round trips include beat1e-20,1/3 and Number.MIN_VALUE gains. Raw text limit32768fits all64subnormal-level points; point count remains64. Top-level curve accessors and nested point/index accessors reject without execution. The single-point graph now extends its held gain through a visible span. No gate was weakened.

This is deterministic linear gain automation, not stereo mixing, live automation capture, effect automation, learned arrangement or musician acceptance. Melody remainsACTIVE; project#8 stays skipped.
