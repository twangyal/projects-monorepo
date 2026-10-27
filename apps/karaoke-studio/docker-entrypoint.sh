#!/bin/sh
# Container entry point: "serve" runs the studio, "setup-models" installs the checksum-pinned models into /models.
set -eu
case "${1:-serve}" in
  serve)
    exec python -m karaoke --model-dir /models --data-dir /data --port "${KARAOKE_PORT:-8765}" --listen-all ;;
  setup-models)
    python scripts/setup_model.py --model-dir /models
    exec python scripts/setup_lyrics_model.py --model-dir /models ;;
  *)
    exec "$@" ;;
esac
