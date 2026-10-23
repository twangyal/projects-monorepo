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
    parser.add_argument("--github-pull", help="Serve a loopback GitHub API with one pull request for this commit.")
    parser.add_argument("--github-direct", help="Serve a direct-commit referenced issue fixture.")
    args = parser.parse_args()
    if os.environ.get("GIT_HISTORY_BROWSER_INSTALLED") != "1":
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from git_history.workbench import create_server

    real_python = sys.executable
    if args.missing_native:
        os.environ["GIT_HISTORY_BROWSER_REAL_PYTHON"] = real_python
        sys.executable = str(Path(__file__).with_name("python_without_site.py"))
    fake = None
    if args.github_pull:
        fake = _fake_github(args.github_pull)
    if args.github_direct:
        fake = _fake_github(args.github_direct)
        fake.commit_pulls.clear()
        fake.issue(9, "Direct issue <script>", "The direct change needs this task context.")
    server = create_server(args.repo, port=0, **({"github_api": fake.url} if fake else {}))
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
        if fake is not None:
            fake.__exit__()


def _fake_github(commit):
    # Load the standard-library fake by path so installed-wheel runs never import the source tree.
    from importlib.util import module_from_spec, spec_from_file_location
    spec = spec_from_file_location("fake_github", Path(__file__).resolve().parents[1] / "fake_github.py")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    fake = module.FakeGitHub(owner="fixture", repo="local-evidence").__enter__()
    fake.pull(1, 'Raise the return value <img src=x onerror="globalThis.OWNED=1">',
              'The caller needed a two-step offset.\n\nCloses #3.\n<script>globalThis.OWNED=1</script>', user="maintainer")
    fake.commit_pulls[commit] = [1]
    fake.comments[1] = [fake.review_comment(1, 11, "src/original.py", "Why two rather than one? <b>bold</b>", line=4)]
    fake.reviews[1] = [fake.review(1, 12, "Two matches the documented offset.", "APPROVED")]
    fake.issue(3, "Offset is off by one", "Results were one lower than documented.")
    return fake


if __name__ == "__main__":
    main()
