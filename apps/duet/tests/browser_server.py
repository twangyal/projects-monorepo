"""Fresh data directory, real production service and real media normalization."""
from pathlib import Path
import os
import signal
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from duet.server import create_server  # noqa: E402

if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='duet-browser-') as directory:
        server = create_server(Path(directory), port=int(os.environ.get('DUET_TEST_PORT', '4220')))
        def terminate(signum, frame):
            raise KeyboardInterrupt
        previous = signal.signal(signal.SIGTERM, terminate)
        try:
            server.serve_forever(poll_interval=.05)
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
            signal.signal(signal.SIGTERM, previous)
