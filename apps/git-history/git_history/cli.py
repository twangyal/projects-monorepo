"""Command line entry point and safe report-file output."""

import argparse
from dataclasses import asdict
import json
import os
from pathlib import Path
import re
import sys
import tempfile

from .context import load_context
from .reader import inspect_repository, list_functions
from .render import MAX_REPORT_BYTES, render_html, render_json
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
    explain = commands.add_parser("explain", help="Produce an evidence report for a line range or Python function.")
    functions = commands.add_parser("functions", help="List functions in a committed Python file.")
    for command in (explain, functions):
        command.add_argument("--repo", default=".", help="Local repository path (default: current directory).")
        command.add_argument("--ref", default="HEAD", help="Committed revision (default: HEAD).")
        command.add_argument("--file", required=True, help="Exact repository-relative file path.")
    selection = explain.add_mutually_exclusive_group(required=True)
    selection.add_argument("--lines", type=_lines, metavar="START:END")
    selection.add_argument("--function", metavar="QUALIFIED_NAME", help="Exact Python function name from the functions command.")
    explain.add_argument("--max-commits", type=int, default=20, help="At most 1–50 range-changing commits (default: 20).")
    explain.add_argument("--context", metavar="FILE", help="Optional local JSON of unverified discussion excerpts for represented commits.")
    explain.add_argument("--format", choices=("html", "json"), default="html")
    explain.add_argument("--output", help="Report file; omitted or '-' writes to stdout.")
    explain.add_argument("--force", action="store_true", help="Replace an existing report output file.")
    functions.add_argument("--format", choices=("text", "json"), default="text")
    args = parser.parse_args(argv)
    try:
        if args.command == "functions":
            catalog = list_functions(args.repo, args.file, ref=args.ref)
            if args.format == "json":
                text = json.dumps(asdict(catalog), ensure_ascii=True, indent=2) + "\n"
            else:
                rows = [f"{catalog.path} at {catalog.revision}"]
                for function in catalog.functions:
                    note = " (over 200 lines; select a smaller --lines range)" if function.end_line - function.start_line + 1 > 200 else ""
                    rows.append(f"{function.start_line}:{function.end_line}\t{function.kind}\t{function.qualified_name}{note}")
                if not catalog.functions:
                    rows.append("No functions found. Use explain --lines START:END to inspect a source range.")
                text = "\n".join(rows) + "\n"
            if len(text.encode("utf-8")) > MAX_REPORT_BYTES:
                raise ValueError("Function listing exceeds 8 MiB. Use explain --lines START:END instead.")
            sys.stdout.write(text)
            return 0
        report = inspect_repository(args.repo, args.file, *(args.lines or (None, None)),
                                    ref=args.ref, max_commits=args.max_commits,
                                    function=args.function)
        context = load_context(args.context, report) if args.context is not None else None
        text = render_html(report, context) if args.format == "html" else render_json(report, context)
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
