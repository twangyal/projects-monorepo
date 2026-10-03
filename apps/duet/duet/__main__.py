"""Run the production loopback service with real media normalization."""

import argparse
from pathlib import Path
import signal

from .server import create_server


def main():
    parser = argparse.ArgumentParser(description='Duet local shared music rooms')
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    server = create_server(args.data_dir, args.port)
    def terminate(signum, frame):
        raise KeyboardInterrupt
    previous = signal.signal(signal.SIGTERM, terminate)
    try:
        print(f'Duet: http://127.0.0.1:{server.server_port}', flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        signal.signal(signal.SIGTERM, previous)


if __name__ == '__main__':
    main()
