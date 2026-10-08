"""Command line entry point and safe report-file output."""

import argparse
from dataclasses import asdict
import json
import os
from pathlib import Path
import re
import signal
import sys
import tempfile
import threading

from .changed_files import list_changed_files, render_changed_files_json
from .comparison import CompareSelection, CompareTarget, compare_repository
from .comparison_render import render_comparison_html, render_comparison_json
from .context import ContextRecords, load_context
from .reader import inspect_repository, list_files, list_functions
from .render import MAX_REPORT_BYTES, render_html, render_json
from .runner import GitError, GitRunner
from .work_budget import WorkBudgetError, check_work_budget, work_budget


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
        check_work_budget()
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
    explain = commands.add_parser("explain", help="Produce an evidence report for a line range or named function.",
                                  description="Inspect a committed range or Python, JavaScript or TypeScript function. JavaScript/TypeScript selection requires the optional javascript extra.")
    functions = commands.add_parser("functions", help="List functions in committed Python, JavaScript or TypeScript source.",
                                    description="List committed Python functions or optional JavaScript/TypeScript functions. Install the javascript extra for JavaScript/TypeScript selection.")
    files = commands.add_parser("files", help="Discover committed source file candidates without parsing them.")
    serve = commands.add_parser("serve", help="Open a read-only local browser workbench for one repository.")
    serve.add_argument("--repo", required=True, help="Fixed local repository path.")
    serve.add_argument("--port", type=int, default=0, help="Loopback port, 0–65535 (default: OS assigned).")
    for command in (explain, functions, files):
        command.add_argument("--repo", default=".", help="Local repository path (default: current directory).")
        command.add_argument("--ref", default="HEAD", help="Committed revision (default: HEAD).")
    for command in (explain, functions):
        command.add_argument("--file", required=True, help="Exact repository-relative file path.")
    files.add_argument("--directory", default="", help="Exact repository-relative directory prefix (default: whole tree).")
    files.add_argument("--language", choices=("all", "python", "javascript", "typescript"), default="all")
    files.add_argument("--format", choices=("text", "json"), default="text")
    selection = explain.add_mutually_exclusive_group(required=True)
    selection.add_argument("--lines", type=_lines, metavar="START:END")
    selection.add_argument("--function", metavar="QUALIFIED_NAME", help="Exact qualified function name from the functions command.")
    explain.add_argument("--max-commits", type=int, default=20, help="At most 1–50 range-changing commits (default: 20).")
    explain.add_argument("--context", metavar="FILE", help="Optional local JSON of unverified discussion excerpts for represented commits.")
    explain.add_argument("--format", choices=("html", "json"), default="html")
    explain.add_argument("--output", help="Report file; omitted or '-' writes to stdout.")
    explain.add_argument("--force", action="store_true", help="Replace an existing report output file.")
    functions.add_argument("--format", choices=("text", "json"), default="text")
    compare = commands.add_parser("compare", help="Compare two explicitly selected committed source regions.")
    compare.add_argument("--repo", default=".", help="Local repository path (default: current directory).")
    for name in ("left", "right"):
        compare.add_argument(f"--{name}-ref", default="HEAD", help="Committed revision (default: HEAD).")
        compare.add_argument(f"--{name}-file", required=True, help="Exact repository-relative file path, including for Missing.")
        group = compare.add_mutually_exclusive_group(required=True)
        group.add_argument(f"--{name}-whole", action="store_true", help="Select the entire committed file (at most 200 lines).")
        group.add_argument(f"--{name}-lines", type=_lines, metavar="START:END")
        group.add_argument(f"--{name}-function", metavar="QUALIFIED_NAME", help="Select one exact qualified function name.")
        group.add_argument(f"--{name}-missing", action="store_true", help="Verify that this exact path is absent at this commit.")
    compare.add_argument("--format", choices=("html", "json"), default="html")
    compare.add_argument("--output", help="Report file; omitted or '-' writes to stdout.")
    compare.add_argument("--force", action="store_true", help="Replace an existing report output file.")
    changes = commands.add_parser("changes", help="Discover changed leaf paths between two committed trees.")
    changes.add_argument("--repo", default=".", help="Local repository path (default: current directory).")
    changes.add_argument("--left-ref", default="HEAD~1", help="Left committed revision (default: HEAD~1).")
    changes.add_argument("--right-ref", default="HEAD", help="Right committed revision (default: HEAD).")
    changes.add_argument("--directory", default="", help="Exact repository-relative subtree (default: whole tree).")
    changes.add_argument("--format", choices=("text", "json"), default="text")
    args = parser.parse_args(argv)
    try:
        if args.command == "changes":
            with work_budget(timeout=45, max_output_bytes=32 * 1024 * 1024):
                catalog = list_changed_files(args.repo, args.left_ref, args.right_ref,
                                             directory=args.directory)
                check_work_budget()
                # Shared admission and serialization bound both output formats.
                canonical = render_changed_files_json(catalog)
                check_work_budget()
                if args.format == "json":
                    text = canonical
                else:
                    value = json.loads(canonical)
                    rows = [f"{json.dumps(value['repo_name'])}: committed-tree changes (no rename detection)",
                            f"Left {json.dumps(value['left_requested_ref'])}: {value['left_revision']}",
                            f"Right {json.dumps(value['right_requested_ref'])}: {value['right_revision']}",
                            "Paths sorted by exact UTF-8 bytes; regular entries are comparison candidates only."]
                    for item in value['entries']:
                        check_work_budget()
                        endpoints = []
                        for side in ('left', 'right'):
                            endpoint = item[side]
                            endpoints.append('absent' if endpoint is None else
                                             f"{endpoint['kind']} {endpoint['mode']} {endpoint['object_id']}")
                        rows.append(f"{item['change']}\t{json.dumps(item['path'])}\t"
                                    f"{endpoints[0]} -> {endpoints[1]}"
                                    + (" (not addressable for comparison)" if not item['addressable'] else ""))
                    if not value['entries']:
                        rows.append("No changed leaf paths found for these trees and directory.")
                    if value['omitted_non_utf8_paths']:
                        rows.append(f"Omitted {value['omitted_non_utf8_paths']} non-UTF-8 changed paths.")
                    text = "\n".join(rows) + "\n"
                    if len(text.encode('utf-8')) > MAX_REPORT_BYTES:
                        raise ValueError("Changed-file listing exceeds 8 MiB; narrow --directory.")
                check_work_budget()
                sys.stdout.write(text)
            return 0
        if args.command == "compare":
            targets = []
            for name in ("left", "right"):
                lines = getattr(args, f"{name}_lines")
                function = getattr(args, f"{name}_function")
                if lines is not None:
                    chosen = CompareSelection("lines", *lines)
                elif function is not None:
                    chosen = CompareSelection("function", function=function)
                else:
                    chosen = CompareSelection("missing" if getattr(args, f"{name}_missing") else "whole")
                targets.append(CompareTarget(getattr(args, f"{name}_ref"),
                                             getattr(args, f"{name}_file"), chosen))
            with work_budget(timeout=45, max_output_bytes=32 * 1024 * 1024):
                report = compare_repository(args.repo, *targets)
                check_work_budget()
                text = (render_comparison_html(report) if args.format == "html"
                        else render_comparison_json(report))
                check_work_budget()
                if args.output and args.output != "-":
                    write_report(Path(args.output), text, args.repo, args.force)
                    print(f"Report saved to {Path(args.output).absolute()}", file=sys.stderr)
                else:
                    sys.stdout.write(text)
            return 0
        if args.command == 'serve':
            from .workbench import create_server
            server = None
            original_term = None

            def terminate(_signal, _frame):
                # Exit the serving thread into finally; shutdown() would wait
                # for this very thread and deadlock here.
                raise KeyboardInterrupt

            try:
                if threading.current_thread() is threading.main_thread():
                    original_term = signal.signal(signal.SIGTERM, terminate)
                server = create_server(args.repo, args.port)
                print(server.url, flush=True)
                server.serve_forever()
            except KeyboardInterrupt:
                pass
            finally:
                if server is not None:
                    server.server_close()
                if original_term is not None:
                    signal.signal(signal.SIGTERM, original_term)
            return 0
        if args.command == "files":
            catalog = list_files(args.repo, ref=args.ref, directory=args.directory, language=args.language)
            if args.format == "json":
                text = json.dumps(asdict(catalog), ensure_ascii=True, indent=2) + "\n"
            else:
                rows = [f"{json.dumps(catalog.repo_name)} at {catalog.revision}",
                        "Source candidates (suffix/size only; contents are not parsed):"]
                rows.extend(f"{item.language}\t{item.size_bytes} bytes\t{json.dumps(item.path)}"
                            for item in catalog.files)
                if not catalog.files:
                    rows.append("No supported source candidates found for these filters.")
                if catalog.omitted_non_utf8_paths:
                    rows.append(f"Omitted {catalog.omitted_non_utf8_paths} regular file paths that are not UTF-8.")
                text = "\n".join(rows) + "\n"
            if len(text.encode("utf-8")) > MAX_REPORT_BYTES:
                raise ValueError("Source listing exceeds 8 MiB; narrow --directory or --language.")
            sys.stdout.write(text)
            return 0
        if args.command == "functions":
            catalog = list_functions(args.repo, args.file, ref=args.ref)
            if args.format == "json":
                text = json.dumps(asdict(catalog), ensure_ascii=True, indent=2) + "\n"
            else:
                rows = [f"{json.dumps(catalog.path)} at {catalog.revision}"]
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
        if isinstance(context, ContextRecords):
            report.supplied_context = context
            context = None
        text = render_html(report, context) if args.format == "html" else render_json(report, context)
        if args.output and args.output != "-":
            write_report(Path(args.output), text, args.repo, args.force)
            print(f"Report saved to {Path(args.output).absolute()}", file=sys.stderr)
        else:
            sys.stdout.write(text)
        return 0
    except BrokenPipeError:
        return 1
    except (GitError, ValueError, OSError, UnicodeError, WorkBudgetError) as error:
        print(f"Git history: {error}", file=sys.stderr)
        return 2
