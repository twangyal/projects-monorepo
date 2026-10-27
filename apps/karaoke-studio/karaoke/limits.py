"""Shared, finite full-song and resource limits; no application dependencies."""

MIN_DURATION = 1
MAX_DURATION = 600
SAMPLE_RATE = 44100
MAX_CUES = 200
MAX_LYRIC_CHARS = 20000
MAX_INPUT_BYTES = 128 * 1024**2
MAX_JSON_BYTES = 256 * 1024
MAX_DECODE_BYTES = MAX_DURATION * SAMPLE_RATE * 2 * 4
MAX_WAV_BYTES = MAX_DURATION * SAMPLE_RATE * 2 * 2 + 4096
WINDOW_FRAMES = 30 * SAMPLE_RATE
OVERLAP_FRAMES = 2 * SAMPLE_RATE
HOP_FRAMES = WINDOW_FRAMES - OVERLAP_FRAMES
MAX_WINDOWS = 22
DECODE_TIMEOUT = 60
# Wall-clock budget per worker. A 10-minute song separated in 550 s (1.4 GiB) on 4 cores with the MDX-Net
# model, so this keeps about 3x headroom. CPU time counts every thread, and separation runs up to four, so
# the CPU limits allow four threads for the whole budget.
WORKER_TIMEOUT = 1800
WORKER_CPU_SOFT = 4 * WORKER_TIMEOUT
WORKER_CPU_HARD = WORKER_CPU_SOFT + 5
MAX_WORKER_RSS_KIB = 3 * 1024**2
WORKER_FILE_BYTES = MAX_DECODE_BYTES + 4096
VIDEO_TIMEOUT = 600
MAX_VIDEO_BYTES = 128 * 1024**2
# After an instrumental break of at least COUNT_IN_BREAK seconds, the last COUNT_IN seconds before the next line
# count singers in.
COUNT_IN, COUNT_IN_BREAK = 3, 4
# Word highlighting: each line has up to 16 highlight steps plus its unsung state, each gap one card, and each break
# long enough to count in (at most one per COUNT_IN_BREAK seconds) COUNT_IN more.
MAX_CARD_BYTES = 192 * 1024**2
MAX_CARDS = MAX_CUES * 17 + MAX_CUES + 1 + COUNT_IN * (MAX_DURATION // COUNT_IN_BREAK)
MAX_VIDEO_FRAMES = MAX_DURATION * 24
# Must exceed a job's scratch budget (checked in tests).
MIN_FREE_BYTES = 2 * 1024**3
MAX_JOB_SCRATCH_BYTES = 1600 * 1024**2
UPLOAD_TIMEOUT = 60
UPLOAD_IDLE_TIMEOUT = 5
