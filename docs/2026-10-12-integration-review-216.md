# Pending canonical integration — #216

Source snapshot: `claude/ecstatic-thompson-su2s2r` at `18afa17b7e06030642bf0a13e86cd3983f6e76c6`, nine completed feature commits after canonical main `fa3e6fc`. The branch contains Gaze real-page/extension navigation, Duet Spotify timeline/song memories and Friendly friend circles. Those features were not yet integrated into canonical main. Melody harmonic tones have independently landed on main at `f3f5124e00e97e914fcb7a3e93389573c954c232` and must be retained by any later integration.

Independent domain reviews found concrete blockers despite passing original branch CI. Bounded repairs were developed in an isolated checkout and are saved as a task-branch checkpoint, not final acceptance or canonical integration. No new PR, production deployment, paid service or account mutation occurred.

## Gaze repairs

Search fallback into an ordinary form field now requires confirmation before writing/submitting; pending confirmation rejects a disconnected target. Queued speech callbacks after stop or from a previous recognizer instance are ignored. Camera retries have generation ownership, so a cancelled startup cannot overtake a fresh start or restoration. Pagehide/stop cancels input; persisted pageshow synchronizes to stopped speech and requires explicit microphone restart while retaining the preference for genuinely new pages.

Red-first unit/native regressions reproduced these failures. Final local Gaze checks:127units,74-file syntax check, build,15 affected desktop native tests passed. Independent cross-review caught and then confirmed the BFCache follow-up repair. Broader viewport/extension acceptance is NOT claimed. An attempted temporary full-Chrome launcher failed across extended cases and needs correction/reinspection; earlier desktop headless-shell checks remain distinct evidence.

## Friendly repairs

Delayed comment completion clears only its submitted form/epoch/input intent; newer text survives. Changed polling restores retained textarea focus and selection. All circle-entry paths use the normal challenge draft guard. Participant departure removes all affected shares/comments/cheers, consistent with explicit withdrawal and without resurrecting conversation upon re-share.

Red-first regressions reproduced all four problems. Local203Python,51TypeScript, lint/type/build and5 focused native cases passed; Python Ruff was unavailable in the local interpreter. A first full browser run passed41/42 and failed original invitation creation because the3 new regression records exhausted the same temporary notebook's real20-record capacity. Production limits and original tests were NOT raised or changed. New cases now use a separate Playwright project, port4251 and isolated temporary notebook; original39 remain on4250. The failed original plus new3 pass together after isolation. Fresh full42-case run is pending at this checkpoint.

## Duet repairs and remaining blocker

Durable auth and connection generations prevent an old account's sync/refresh/error reply from modifying a replacement connection. Disconnect/new authorization/room deletion invalidates in-flight callbacks, and final callback admission rechecks room existence under the existing deletion lock. Existing connected rows migrate without losing credentials; legacy pending callbacks are discarded and must restart.

Three original failures reproduced before repair.30focusedPython cases pass (including seven new regression cases),23TypeScript tests, lint/type/build, compilation and diff checks pass. Full Duet native acceptance has NOT been run on these repairs. Some local HTTP fixture invocations also refused unavailable `/proc` file-descriptor access; no existing guard was bypassed.

**Blocking:** `duet/photos.py` still admits header-only, undecodable PNG/GIF/JPEG/WebP data. Existing acceptance fixtures for several formats are headers, not complete images. Add an explicitly bounded complete decoder (the existing isolated FFmpeg infrastructure is a possible foundation), genuine complete raster fixtures and truncated/corrupt/over-budget regressions; retain all passive-type,byte,pixel,storage and serving protections. Do not call header sniffing complete media verification. Duet must stay off canonical main until this is resolved and full checks pass.

## Original hosted source evidence

Downloaded job logs, not just run conclusions:

- [Gaze38314074083](https://github.com/twangyal/projects-monorepo/actions/runs/38314074083), job115026620414, exact `d408fe5`:124units/160browsers plus syntax/build passed.
- [Duet38317785065](https://github.com/twangyal/projects-monorepo/actions/runs/38317785065), job115038443066, exact `a2d93f0`:249Python/23TypeScript/69browsers and project gates passed.
- [Friendly38319449211](https://github.com/twangyal/projects-monorepo/actions/runs/38319449211), job115043767521, exact `18afa17`:202Python/51TypeScript/39browsers and project gates passed.

These receipts predate the repairs and do not certify them. Final task-branch hosted CI, extended Gaze verification, full Friendly rerun, Duet decoding/acceptance and canonical integration remain tracked by#216. No physical webcam, real Spotify account/provider, physical friend-device acceptance or Jev integration is established. All projects remain ACTIVE; project#8 stays skipped. Preserve both roadmap updates and main's newer Melody/Clothing work when integrating.

## Final checkpoint update

Fresh isolated Friendly full browser gate completed: **42/42 pass**, including all original39 and new3 with unchanged production limits. The first notebook-capacity failure remains recorded above.

Extended Gaze attempt finished **64 failed /16 did not run** before meaningful app acceptance: extension setup used a temporary launcher from the repository root and could not find `scripts/build-extension.js`; full Chrome startup then refused its process-singleton socket with `Operation not permitted` (and restricted ptrace). This is distinct from the passing15 desktop headless-shell cases. Correct the extension working directory and use an environment permitting normal full-Chrome local sockets; do not bypass platform security or call these cases passing.

Fresh task-source hosted checks started for901f9d0: Gaze38322465441, Duet38322465447, Friendly38322465711. Outcomes are pending, not certified. Next run must inspect actual job logs and remaining Duet photo/media blocker before canonical integration. Main remains the verified harmonic-tone head f3f5124.


## Follow-up verification and photo admission repair

Actual hosted logs for repair source 901f9d0 now confirm Gaze 127 units / 176 browser cases, Duet 256 Python / 23 TypeScript / 69 browser cases, and Friendly 203 Python / 51 TypeScript / 42 browser cases, with each project gate green. These supersede pending hosted outcomes above; the failed local extended launcher remains a distinct runtime limitation.

The photo-header blocker reproduced with five header-only inputs and a truncated PNG. Complete synthetic raster fixtures now exercise JPEG/PNG/WebP/GIF. Admission uses the existing isolated FFmpeg runner with fixed demuxers, local-only protocols, five-second deadline, 512 MiB process bound, 16-million-pixel individual bound and 32-million-pixel streamed aggregate bound. PNG chunks have complete lengths/CRCs/endings; GIF block lengths, color tables, frame rectangles and terminators are walked, and decoded frame counts must match. Independent review reproduced truncated GIF sub-block salvage and APNG first-frame-only decoding; regressions now reject both. Animated PNG/WebP are explicitly unsupported rather than claiming full animation validation. Six local inspection tests pass with genuine decoding; full HTTP acceptance must use hosted CI because this runtime refuses the existing /proc descriptor guard. No guard was bypassed. New photo-source hosted acceptance remains pending until receipts are recorded.


An exact-limit smoke test then found a genuine 4000×4000 PNG refused because FFmpeg checks its padded 4032×4000 internal buffer against max_pixels. The codec allocation ceiling now allows bounded padding; public dimensions remain ≤16M pixels, exact decoded output checks remain, and memory/time/aggregate limits are unchanged. A seventh real-decoder regression accepts the exact-limit PNG and refuses complete three-frame GIF data on a 16M-pixel canvas before starting the worker. All seven inspection cases and Ruff pass locally. This updated source requires its own final hosted receipt.


Hosted0d7d1a1 run38324214455 failed one of261 Python cases: the16M PNG worker refused it with the intentionally generic public error. A diagnostic-only rerunfe546f0 passes that Python gate on a fresh runner; its full outcome is separate. A controlled local448MiB AS experiment reproduced RGBA packet allocation failure (64MB), while RGB24 decoded the same16M image successfully (48MB). Admission now streams RGB24 to provide headroom without changing original bytes/alpha, public dimensions, frame counts,512MiB/time or aggregate pixel guards. Seven local real-decoder cases and Ruff pass. The hosted cause remains an inference from the local reproducer, not a disclosed first-run diagnostic. Original failed evidence remains retained.
