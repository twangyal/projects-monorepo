> Historical evidence for the initial 1–30-second milestone. Current supported bounds and newer full-song verification are described in the README. These original measurements remain unchanged.

# Initial local verification

Verified on Linux x86_64 with a four-CPU quota, 16 GiB memory, Python 3.11.16,
Node 24.19, system Chromium, FFmpeg, Spleeter 2.4.2, and TensorFlow 2.12.1.
Reproduction commands and model/sample provenance are in the app README.

## Real inference

The production pipeline used the checksum-pinned official two-stem model with
network calls blocked inside the worker. Raw measured reports are saved in
[`2026-10-03-model-smoke.json`](2026-10-03-model-smoke.json).

| Input | Clip duration | Pipeline elapsed | Inference elapsed | Peak worker RSS |
| --- | --- | --- | --- | --- |
| Original synthetic audio | 1 s | 5.21 s | 2.34 s | 770 MiB |
| Official licensed singing example | 10 s | 5.73 s | 2.69 s | 857 MiB |
| Original synthetic audio | 30 s | 7.47 s | 3.76 s | 1,159 MiB |

All outputs were nonempty, finite before PCM conversion, and exactly matched the
input duration as stereo 44.1 kHz PCM16 WAV. Vocal and backing stems differed.
The singing example produced a raw backing peak above 1; shared gain 0.982512
prevented integer wrap while preserving relative stem levels. These observations
verify functioning inference and output bounds, not isolation accuracy. No
reference-stem quality score was established.

## Production browser and video

The actual production service completed this flow using the first ten seconds of
the official CC BY 3.0 singing example: upload → real separation → audition all
three signals → supply original test cue text → edit/save timing → reload project
→ export/download MP4. The test cue text checks timing and is not a transcription
of the recording. The decoded video frame at one second displayed the expected
active cue and upcoming line. FFprobe reported H.264 1280×720 at 24 fps, stereo
44.1 kHz AAC, and a 10.000-second container duration.

Real Chromium seeking was also checked after the HTTP byte-range fix: seek to
one second → first cue active → switch to vocals and backing without losing
position → seek to 2.75 seconds → instrumental gap. Desktop and 390-pixel mobile
layouts had no page errors or horizontal overflow.

Automated video tests inspect decoded frames immediately around multiple cue
start/end boundaries. Fast HTTP/browser tests inject a fake separator and use
the real video encoder; they must not be counted as real inference evidence.

## Review and limits

Independent review reproduced and then verified fixes for unapplied pasted-word
loss, editing during project loads, and a second service instance deleting an
active job's files. An exclusive data-directory lock now precedes cleanup. Tests
cover request boundaries, cancellation/reaping, failed publication rollback,
revision conflicts, storage limits and explicit selected-project deletion.

No subjective listening score, automatic lyric alignment, full-song processing,
non-Linux compatibility, or broad browser/device claim is made by these checks.
