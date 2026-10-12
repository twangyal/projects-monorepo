# Editable harmonic tones — #215

## Outcome and design

Users can create a track timbre from eight editable sine-partial amplitudes, audition/export it using the existing synthesis path and recover the whole applied project. This closes a fixed-waveform sound-design gap under the revised full-DAW direction. It is a bounded extension of existing per-track sound settings, without a new audio engine or paid dependencies.

`harmonics` is an optional strict eight-element numeric array; amplitudes are finite0..1 with at least one positive. Descriptor validation rejects holes, extras, symbols, getters and nonstandard array prototypes without reading getters. Validated arrays are detached. Both the composition validator and strict reference-bearing document admit the field, while retaining old field/accessor checks. Legacy absence retains the original serialized shape and PCM.

At each pitch, the renderer creates a4096-step zero-phase sine-partial table. It omits frequencies at/above Nyquist and normalizes coefficients by the configured total before multiplication, preserving subnormal positive amplitudes. It does not renormalize after omission. All-omitted profiles yield silence, disclosed in the UI. Wavetable interpolation is approximate; this is not an alias-free or realistic-instrument claim. Groups and voices include the profile in their keys, so simultaneous unlike timbres are not collapsed. Filter, envelope, echo, absolute volume automation and existing peak limiting retain their established order and semantics.

The existing raw per-track field map, explicit Apply/Discard, preblur sound admission, keyboard guards, complete-project history and shared worker handle the new controls. No MIDI mapping changes: chosen base programs remain, custom harmonic content stays out of MIDI. Captured reference audio stays unchanged.

## Failure evidence and repairs

Initial units failed because the model discarded unknown harmonics and synthesis ignored the profile. The native RED case then failed because the controls did not exist. Initial test setup caught a descriptor-array TypeScript inference mismatch and a missing temporary browser; those were repaired before the meaningful native missing-control failure.

Independent review identified multiply-before-normalize underflow for a valid `Number.MIN_VALUE` profile. A failing independent PCM regression reproduced it; coefficients now normalize first. Native full-project Apply also exposed the strict reference-document track allowlist omission. A failing document-level test reproduced the refusal before the optional field was admitted; no general strictness was weakened. Review confirmed both fixes and no additional concrete blocker.

Executed verification counts and final outcomes will be recorded after the full gate finishes. Physical output-device sound, musician usefulness, acoustic realism and alias-free behavior are not established by numerical/native-browser checks. Project#8 remains skipped; Melody remains ACTIVE.

## Final local verification

On2026-10-12 with Node24 and official Chrome for Testing153.0.8010.12:

- `npm run check`: **417 units**, ESLint, TypeScript and production build passed.
- `CHROMIUM_PATH=… npm run test:browser -- --workers=2`: full **224/224 browser tests passed**.
- Native actual WAV download was compared at every37th sample against independently summed sine partials, note start rounding, envelope levels and16-bit quantization (≤2LSB tolerance). MIDI bytes remained identical. Complete original reference bytes, other track state, Undo/Redo, autosave/reload and track duplication were checked.
- Invalid/all-zero drafts, per-track draft retention, bypass exact legacy PCM, focused unrelated drafts before blur and390px keyboard Apply passed. The narrow control screenshot was inspected for readability and containment.
- Independent review confirmed the two repairs and reported no remaining concrete blockers.

These are executed local checks; final hosted CI has not yet been inspected. Actual physical sound-device output and musician-quality evaluation remain open product work.
