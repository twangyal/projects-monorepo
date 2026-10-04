# Karaoke full-song processing

Issue #33 · `apps/karaoke-studio` · branch Astra. The user authorizes independent design and implementation; no additional approval gate applies. Excluded projects are outside this work.

## Outcome

Import a complete local song of 1–300 seconds, estimate two stems with the existing verified offline Spleeter checkpoint, audition/seek, supply and correct lyrics, save/reopen, and export the complete H.264/AAC karaoke video. Existing schema-v1 short projects remain readable. There is no new model, network service, automatic lyric recognition or alignment.

Extending only the duration constant would expose unbounded inference growth and inconsistent UI/export limits. Use sequential overlapping windows inside the existing killable worker, with exact sample placement and one final gain. A five-minute real-model measurement is required before declaring this milestone complete. If repeated Spleeter calls leak beyond the memory budget, fix/reconsider the worker strategy and document the actual result; do not silently relax the bound or claim completion.

## Shared limits and compatibility

Introduce `karaoke/limits.py`, importing no application modules. Model, pipeline, worker and video consume these constants, preserving currently imported public constants where tests/callers use them.

- `MIN_DURATION = 1`, `MAX_DURATION = 300`, `SAMPLE_RATE = 44100`.
- `MAX_CUES = 200`, `MAX_LYRIC_CHARS = 20000`; unchanged title100/cue240 Unicode-code-point limits and ordered nonoverlapping intervals. Python and TypeScript must agree on code-point counting, Python strip/splitlines semantics for drafts, and rejection of malformed Unicode/NUL. Raw pasted text counts toward its limit before stripping empty lines. Empty/invalid editor drafts remain recoverable, never silently clipped.
- `MAX_INPUT_BYTES = 64 * 1024 * 1024`; supports a five-minute canonical WAV (52,920,044 bytes) with bounded container overhead. HTTP upload and pipeline agree. Playlists, remote URLs and video remain rejected.
- `MAX_JSON_BYTES = 256 * 1024`, enough for the enlarged valid Unicode lyric document including JSON escapes. Validate schema/fields and existing CSRF/origin/revision boundaries as before.
- Decode at most `300 * 44100 * 2 * 4` float32 bytes, with complete-frame checks and strict decoded duration. Existing MP3/Ogg probe allowance of 0.2 seconds applies only to encoder metadata; decoded frames are never trimmed to satisfy the limit. Decode subprocess wall limit60s.
- Worker wall600s, CPU600s soft/605s hard, observed RSS3GiB. Worker file-size bound covers one full stereo float32 stem plus a small header allowance; finite positive durations never remove the bound. One active service media job remains the limit.
- One overall video-export wall deadline600s covers backing validation, card/frame preparation and encoding; pass only the remaining budget to the encoder. Aggregate distinct-card bytes64MiB, at most401 cards and7200 frame hardlinks. Video output128MiB; 1280×720/24fps and 192k AAC unchanged. Check cancellation during card/frame preparation and process supervision. Keep final publication atomic and preserve existing exports on error.
- Before upload/export work, require at least1GiB available on the owned job filesystem using the retained directory descriptor. This admission check is not a reservation; ENOSPC still fails safely. Fixed counts and per-file limits must keep job scratch below800MiB, including decoded float scratch if used, float stems, canonical WAVs and publication copies. Check cancellation during normalization, WAV validation and publication copies.
- Keep the existing five-second upload inactivity timeout and add a60-second absolute upload deadline with deadline-aware bounded reads; continuous trickles cannot occupy the single slot indefinitely.
- Keep twenty completed projects; document approximate worst-case WAV storage (about151.4MiB for three stems at five minutes), temporary working space and optional video rather than hiding the increased disk use. No automatic deletion or paid storage.

## Exact chunked signal contract

Planning uses integer frames exclusively: 30-second maximum window (1,323,000 frames), two-second overlap (88,200), 28-second hop (1,234,800). Start at zero, append a next window only while the preceding end is before the input end. Each range is `[start, min(start+window,N))`; all N frames are covered, no duplicates in the final output, at most eleven calls for five minutes. The last partial window is longer than the overlap whenever it exists. Single-window clips retain their full current sample positions.

Each inference receives only its source range as float32 stereo. Both returned arrays must have the same exact input shape and finite samples. Do not silently pad, crop or repair a mismatched model response. The existing model supports these bounded window sizes; the real gate must verify tail windows as well as whole windows.

Outside an overlap, retain the one prediction. For an overlap of L frames, frame i (zero-based) uses incoming weight `(i + 0.5) / L` and preceding weight `1 - incomingWeight` on both channels. These complementary weights sum to one and avoid a gain dip for identical predictions. Stitch in floating point; never quantize or normalize each chunk separately. Distinct model estimates can still produce audible boundary changes; weighting is not a quality guarantee.

Assembly must be independently testable without TensorFlow or NumPy in the fast environment. Prefer a stdlib module that plans ranges and streams contiguous float32 blocks while retaining only an overlap tail. The ML worker may use its existing NumPy dependency at the model boundary. Temporary full float32 stems are permitted in the owned job directory to support a two-pass shared peak/gain conversion without holding the entire song in RAM. Writes/checks are bounded, exact-size, and clean up on all exits.

Find the maximum absolute value across both assembled stems. Apply one common gain `1 / peak` only when peak exceeds1, otherwise1, then the existing nearest-even PCM16 rounding/clipping convention. Write stereo44.1kHz WAVs of exactly N frames. Do not independently normalize channels/stems/chunks. Unit oracles must cover impulses/ramps through boundaries, different left/right values, identity predictions, deliberately differing overlap predictions, a tiny final extension, exact30/58/300-second planning, and a >1 peak in a late chunk affecting the complete output.

The worker publishes atomic bounded `progress.json` records `{currentChunk, completedChunks, totalChunks}` before/after actual inference calls; counters are integers with0≤completed≤total≤11 and1≤current≤total. Pipeline polling validates at most1024bytes at bounded intervals, reports actual window activity, and does not claim a speed/ETA. These files and `.part` versions are removed after success/failure.

Metadata preserves current model release/archive hash/runtime/offline evidence and adds the chunk scheme, integer window/overlap/hop frames, actual ranges/count and exact frame count. `stemPeak`/`stemGain` refer to assembled output. The model cache must validate before use; intercepted network attempts remain fatal. A new worker starts per job, processes its windows sequentially, and remains under parent process-group cancellation and RSS/wall supervision.

## Pipeline, progress and ownership

Keep retained directory handles and inherited media descriptors; never resolve `/proc/self/fd/...` job paths back through a mutable library parent. New scratch files have fixed generated names inside owned temporary work. Pipeline cleanup removes all new float/partial media as well as current output names on failure. No partial project is published, and terminal status still means cleanup released the single worker.

Decode remains bounded and validates every sample; conversion should process bounded blocks and check cancellation during CPU loops instead of freezing the service thread for a five-minute conversion. The source has one consistent normalization gain. Streamed or blockwise validation/conversion is preferred over multiplying full-song buffers. Calls already used in tests may keep optional cancellation arguments for compatibility.

Report actionable job stages during complete decode, local window inference and final checks. If progress is exposed, it must follow actual completed work through a bounded fixed-location progress record or bounded pipe; do not fabricate percentage estimates. No new remote status surface is needed.

Server capability metadata exposes `maxDuration`, `maxUploadBytes`, `maxCues`, `maxLyricChars` for the agreed duration/upload/cue/lyric limits for UI awareness; the server remains authoritative. UI copy states five minutes/64MiB, full supplied lyrics, and potential processing wait. Existing unsaved history, request generations, active-job exclusion and save/revision behavior remain intact. Avoid unrelated UI redesign.

## Verification and evidence

1. Fast Python tests independently exercise chunk planning/assembly/global gain, duration/byte/lyric/JSON boundaries, compressed padding, cancellation/cleanup and old short-project compatibility. No installed ML or downloaded weights in ordinary CI.
2. TypeScript tests cover200 cues/20,000 code points, long durations, invalid boundaries and history compatibility. Browser workflows use the explicitly fake separator for a >30-second real WAV, actual seeking/lyric editing/save/reopen/SRT and decoded MP4; retain existing regression suite and distinguish this from model evidence.
3. Run the installed verified cache offline on original180s and300s audio through the real pipeline. Record exact versions, elapsed stages, maximum worker RSS, matching N-frame source/stems, finite samples/global gain, offline attempts0 and temporary/published disk use. Do not invent a full-song singing evaluation from repeated short audio.
4. A separate maximum-duration real production service/browser workflow exercises actual inference, supplied cues around a window boundary and near the end, save/reopen and a complete300s MP4. Decode actual frames around cue boundaries and confirm H.264/AAC,24fps,duration; do not treat header metadata alone as video correctness.
5. Listen to representative source/stem boundaries if audio inspection is available, and state exactly what was inspected. Synthetic signal plumbing and decoded timeline checks do not prove real-song isolation quality. Preserve existing licensed-example attribution if reused; do not fetch new media.
6. Cancellation during a later window/export must leave no partial published project and reap processes; service restart reopens completed work. Final targeted checks and scoped CI pass before closing#33.

## Ownership

Root owns this contract/plan, GitHub/Git, README/catalog/CI and final integration/evidence. `audio_engine` owns chunk assembly and worker; `recorder` owns decode/pipeline plus real smoke runner; `git_history_review` owns shared limits/model/server and unit tests; `next_project_assessment` owns TypeScript lyric validation/UI/tests; `git_runner` owns production browser and independent signal acceptance tests; `git_reader` owns video export/tests and independent final review. No shared production builds or heavy real-model runs without root coordination. Owners publish narrow interfaces before dependents implement. Root releases implementation after independent contract review.

## Reviewed implementation interfaces

`karaoke/chunks.py` stays stdlib-only: frozen `AudioWindow(start:int, frames:int)`; `plan_windows(frame_count, *, window_frames=1323000, overlap_frames=88200)`; `FloatStemAssembler(frame_count, vocals:BinaryIO, backing:BinaryIO, *, window_frames=..., overlap_frames=..., check=None)` with `.windows`, `.append(index, vocals_bytes, backing_bytes)`, `.finish()`; `scan_float_peak(paths, frame_count, check=None)`, `normalization_gain(peak)`, `write_pcm16_wav(float_path, output, frame_count, gain, check=None)`. Bytes are stereo little-endian float32. Invalid counts/order/truncation/nonfinite values fail; the public planner is bounded at300seconds, optional tiny windows support independent tests with no triple overlap. Worker scratch names are `vocals.float32.part`, `backing.float32.part`, `progress.json`, `progress.json.part`; WAV/processing partial names retain existing conventions. Constants include `WINDOW_FRAMES`, `OVERLAP_FRAMES`, `HOP_FRAMES`, `MAX_WINDOWS`, and documented resource limits. Owners coordinate exact names before dependent edits.

Independent review by git_history_review, audio_engine, git_reader and UI/browser owners resolved disk admission, absolute upload lifetime, shared gain, no hidden model-output repair, Unicode parity and one overall export deadline. Implementation is released under the user's existing autonomous authorization.
