"""Trusted browser-test launcher; never imports code from the inspected repository."""
import argparse
from importlib.metadata import PackageNotFoundError, version
import json
import os
from pathlib import Path
import signal
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--missing-native", action="store_true")
    args = parser.parse_args()
    if os.environ.get("GIT_HISTORY_BROWSER_INSTALLED") != "1":
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from git_history.workbench import create_server

    real_python = sys.executable
    if args.missing_native:
        os.environ["GIT_HISTORY_BROWSER_REAL_PYTHON"] = real_python
        sys.executable = str(Path(__file__).with_name("python_without_site.py"))
    server = create_server(args.repo, port=0)
    try:
        native_available = not args.missing_native and all(
            version(package) == expected
            for package, expected in (
                ("tree-sitter", "0.25.2"),
                ("tree-sitter-javascript", "0.25.0"),
                ("tree-sitter-typescript", "0.23.2"),
            )
        )
    except PackageNotFoundError:
        native_available = False

    def interrupt(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupt)
    print(json.dumps({"url": server.url, "native_available": native_available}), flush=True)
    try:
        server.serve_forever(poll_interval=0.05)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
