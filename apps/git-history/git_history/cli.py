"""Command line entry point and safe report-file output."""

import argparse
import os
from pathlib import Path
import re
import sys
import tempfile

from .reader import inspect_repository
from .render import render_html, render_json
from .runner import GitError, GitRunner


def _lines(value: str) -> tuple[int, int]:
    if not re.fullmatch(r"[1-9][0-9]*:[1-9][0-9]*", value):
        raise argparse.ArgumentTypeError("Use a positive line range such as 20:45.")
    try:
        start, end = map(int, value.split(":"))
    except ValueError as error:
        raise argparse.ArgumentTypeError("Line numbers are too large.") from error
    if end < start or end - start + 1 > 200:
        raise argparse.ArgumentTypeError("Select 1–200 lines in ascending order.")
    return start, end


def _protect_metadata(output: Path, repo: str) -> None:
    resolved = output.resolve()
    if ".git" in resolved.parts or ".git" in output.absolute().parts:
        raise ValueError("Refusing to write a report into Git metadata.")
    # The output can be outside the inspected repository. Discover metadata at
    # its destination as well, including bare and separately named Git dirs.
    destination = resolved.parent
    while not destination.is_dir() and destination != destination.parent:
        destination = destination.parent
    for location in {Path(repo).resolve(), destination}:
        runner = GitRunner(location)
        try:
            directories = [runner.run("rev-parse", option).decode("utf-8").removesuffix("\n")
                           for option in ("--absolute-git-dir", "--git-common-dir")]
        except GitError:
            if location == Path(repo).resolve():
                raise
            continue  # An ordinary output directory need not be a repository.
        for raw_directory in directories:
            directory = Path(raw_directory)
            if not directory.is_absolute():
                directory = location / directory
            directory = directory.resolve()
            if resolved == directory or directory in resolved.parents:
                raise ValueError("Refusing to write a report into Git metadata.")


def write_report(output: Path, text: str, repo: str, force: bool = False) -> None:
    _protect_metadata(output, repo)
    if not output.parent.is_dir():
        raise ValueError(f"Output directory does not exist: {output.parent}")
    if output.exists() and not force:
        raise ValueError(f"Output already exists: {output}. Use --force to replace it.")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent,
                                         prefix=".git-history-", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(text)
        if force:
            os.replace(temporary, output)
        else:
            # Atomic no-clobber publication, including a file created while we
            # were rendering. Never follow an existing output symlink.
            try:
                os.link(temporary, output)
            except FileExistsError as error:
                raise ValueError(f"Output already exists: {output}. Use --force to replace it.") from error
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="git-history", description="Inspect committed source history using local Git evidence.")
    commands = parser.add_subparsers(dest="command", required=True)
    explain = commands.add_parser("explain", help="Produce a portable evidence report for a line range.")
    explain.add_argument("--repo", default=".", help="Local repository path (default: current directory).")
    explain.add_argument("--ref", default="HEAD", help="Committed revision (default: HEAD).")
    explain.add_argument("--file", required=True, help="Exact repository-relative file path.")
    explain.add_argument("--lines", type=_lines, required=True, metavar="START:END")
    explain.add_argument("--max-commits", type=int, default=20, help="At most 1–50 range-changing commits (default: 20).")
    explain.add_argument("--format", choices=("html", "json"), default="html")
    explain.add_argument("--output", help="Report file; omitted or '-' writes to stdout.")
    explain.add_argument("--force", action="store_true", help="Replace an existing report output file.")
    args = parser.parse_args(argv)
    try:
        report = inspect_repository(args.repo, args.file, *args.lines, ref=args.ref,
                                    max_commits=args.max_commits)
        text = render_html(report) if args.format == "html" else render_json(report)
        if args.output and args.output != "-":
            write_report(Path(args.output), text, args.repo, args.force)
            print(f"Report saved to {Path(args.output).absolute()}", file=sys.stderr)
        else:
            sys.stdout.write(text)
        return 0
    except BrokenPipeError:
        return 1
    except (GitError, ValueError, OSError, UnicodeError) as error:
        print(f"Git history: {error}", file=sys.stderr)
        return 2
