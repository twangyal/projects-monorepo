"""Production service, real clock and an isolated notebook for Chromium tests."""
from pathlib import Path
import signal
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from challenges.server import create_server  # noqa: E402


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="friendly-browser-") as directory:
        server = create_server(Path(directory), port=4250)
        signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
        try:
            server.serve_forever(poll_interval=.05)
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
