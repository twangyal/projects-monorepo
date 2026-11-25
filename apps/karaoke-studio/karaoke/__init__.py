"""Local karaoke editing with offline audio separation."""

import os

# The native uploader is outside Python's socket guards. Opt out before any ML
# import; the post-import telemetry API can be too late for initialization events.
os.environ['ORT_DISABLE_TELEMETRY'] = '1'
