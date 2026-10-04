"""Run the default loopback service or explicitly configured HTTPS/LAN service."""

import argparse
from pathlib import Path
import signal

from .server import create_server
from .transport import TransportError, prepare_transport


def main():
    parser = argparse.ArgumentParser(description='Duet local shared music rooms')
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--bind')
    parser.add_argument('--origin')
    parser.add_argument('--tls-cert', type=Path)
    parser.add_argument('--tls-key', type=Path)
    parser.add_argument('--setup-token-file', type=Path)
    args = parser.parse_args()
    options = (args.bind, args.origin, args.tls_cert, args.tls_key, args.setup_token_file)
    if any(value is not None for value in options) and any(value is None for value in options):
        parser.error('Provide --bind, --origin, --tls-cert, --tls-key and --setup-token-file together.')
    transport = None
    try:
        if all(value is not None for value in options):
            transport = prepare_transport(bind=args.bind, port=args.port, origin=args.origin,
                                          tls_cert=args.tls_cert, tls_key=args.tls_key,
                                          setup_token_file=args.setup_token_file)
            server = create_server(args.data_dir, args.port, transport=transport)
        else:
            server = create_server(args.data_dir, args.port)
    except TransportError as error:
        parser.error(str(error))
    except OSError:
        if transport is None:
            raise
        parser.error('Could not start the HTTPS service. Check the bind address, available port and library access permissions.')
    def terminate(signum, frame):
        raise KeyboardInterrupt
    previous = signal.signal(signal.SIGTERM, terminate)
    try:
        origin = transport.origin if transport else f'http://127.0.0.1:{server.server_port}'
        print(f'Duet: {origin}', flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        signal.signal(signal.SIGTERM, previous)


if __name__ == '__main__':
    main()
