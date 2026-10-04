"""Run Git without a shell, enforcing time and combined output limits."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import math
import os
from pathlib import Path
import selectors
import signal
import subprocess
import time

from .work_budget import charge_work_output, check_work_budget


class GitError(RuntimeError):
    """Git could not complete a requested read."""


class GitTimeout(GitError):
    """A command exceeded its time budget."""


class GitOutputLimit(GitError):
    """Combined stdout and stderr exceeded the output budget."""


# These variables can redirect reads into another repository, alter its objects,
# or inject command configuration. Repository-configured object alternates are
# retained; process-inherited object overrides are deliberately not retained.
_REPOSITORY_ENV = frozenset({
    "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE",
    "GIT_GRAFT_FILE", "GIT_SHALLOW_FILE", "GIT_CEILING_DIRECTORIES",
    "GIT_DISCOVERY_ACROSS_FILESYSTEM", "GIT_PREFIX", "GIT_CONFIG",
    "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS", "GIT_EXTERNAL_DIFF",
    "GIT_LITERAL_PATHSPECS", "GIT_GLOB_PATHSPECS", "GIT_NOGLOB_PATHSPECS",
    "GIT_ICASE_PATHSPECS", "GIT_DIFF_OPTS",
})


def _validate_limits(timeout: float, max_bytes: int) -> None:
    try:
        invalid_timeout = (
            isinstance(timeout, bool) or not isinstance(timeout, (int, float))
            or not math.isfinite(timeout) or timeout <= 0
        )
    except OverflowError:
        invalid_timeout = True
    if invalid_timeout:
        raise ValueError("timeout must be a positive finite number of seconds")
    if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or max_bytes <= 0:
        raise ValueError("max_bytes must be a positive integer")


def _git_environment() -> dict[str, str]:
    # Keep ordinary environment settings, including proxies, locale and PATH.
    # Never log this mapping: it may contain credentials.
    env = {
        key: value for key, value in os.environ.items()
        if key not in _REPOSITORY_ENV
        and not key.startswith(("GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_", "GIT_TRACE"))
    }
    env.update(
        GIT_PAGER="cat", PAGER="cat", GIT_OPTIONAL_LOCKS="0",
        GIT_TERMINAL_PROMPT="0", GIT_NO_LAZY_FETCH="1", GIT_NO_REPLACE_OBJECTS="1",
    )
    return env


def _kill_and_reap(process: subprocess.Popen[bytes]) -> None:
    if os.name == "posix":
        # Git helpers must not survive a command limit or keep its pipes open.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    elif process.poll() is None:
        process.kill()
    process.wait()


def _run_bounded(
    argv: Sequence[str],
    *,
    cwd: str | Path,
    env: Mapping[str, str],
    timeout: float,
    max_bytes: int,
) -> bytes:
    """Private subprocess primitive; the public runner only executes Git.

    Both streams are drained concurrently and counted together. A read is at
    most the remaining budget plus one byte, so even a limitless producer does
    not allocate an unbounded buffer. Failure messages quote bounded stderr,
    never argv or the inherited environment.
    """
    _validate_limits(timeout, max_bytes)
    check_work_budget()
    deadline = time.monotonic() + timeout
    try:
        process = subprocess.Popen(
            list(argv), cwd=cwd, env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=False,
            bufsize=0, start_new_session=os.name == "posix",
        )
    except (OSError, ValueError) as error:
        raise GitError(f"Could not start Git: {str(error)[:4096]}") from error

    stdout = bytearray()
    stderr = bytearray()
    total_bytes = 0
    completed = False
    selector = selectors.DefaultSelector()
    try:
        assert process.stdout is not None and process.stderr is not None
        selector.register(process.stdout, selectors.EVENT_READ, stdout)
        selector.register(process.stderr, selectors.EVENT_READ, stderr)
        while selector.get_map():
            check_work_budget()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise GitTimeout(f"Git command exceeded {timeout:g} seconds")
            # A finite Python float may still exceed the OS poll time range.
            for key, _ in selector.select(min(remaining, .1)):
                chunk = os.read(key.fd, min(65536, max_bytes - total_bytes + 1))
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                total_bytes += len(chunk)
                charge_work_output(len(chunk))
                if total_bytes > max_bytes:
                    raise GitOutputLimit(f"Git command exceeded {max_bytes} output bytes")
                key.data.extend(chunk)

        while process.poll() is None:
            check_work_budget()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise GitTimeout(f"Git command exceeded {timeout:g} seconds")
            try:
                process.wait(timeout=min(remaining, .1))
            except subprocess.TimeoutExpired:
                continue
        check_work_budget()
        returncode = process.returncode
        completed = True
        if returncode:
            detail = bytes(stderr[:4096]).decode("utf-8", errors="replace").strip()
            if len(stderr) > 4096:
                detail += " [stderr truncated]"
            message = f"Git command failed (exit status {returncode})"
            if detail:
                message += f": {detail}"
            raise GitError(message)
        return bytes(stdout)
    except OSError as error:
        raise GitError(f"Could not read Git output: {str(error)[:4096]}") from error
    finally:
        if not completed:
            _kill_and_reap(process)
        selector.close()
        if process.stdout is not None:
            process.stdout.close()
        if process.stderr is not None:
            process.stderr.close()


class GitRunner:
    """Read Git data from a fixed repository with bounded subprocess output.

    Callers use read-only Git commands and disable external diff/textconv with
    their command-specific flags. This runner disables pagers, fsmonitor,
    external-diff environment overrides, interactive prompts and optional locks.
    Replacement objects are disabled so evidence matches the resolved object ID.
    Formatted metadata uses UTF-8; raw object reads retain their original bytes.
    """

    def __init__(
        self, repo: str | Path, timeout: float = 10, max_bytes: int = 2_097_152,
    ) -> None:
        _validate_limits(timeout, max_bytes)
        self.repo = Path(repo).resolve()
        self.timeout = timeout
        self.max_bytes = max_bytes

    def run(self, *args: str, max_bytes: int | None = None) -> bytes:
        """Return stdout bytes; failures expose a bounded stderr diagnostic."""
        limit = self.max_bytes if max_bytes is None else max_bytes
        _validate_limits(self.timeout, limit)
        if any(not isinstance(arg, str) or "\0" in arg for arg in args):
            raise ValueError("Git arguments must be strings without NUL bytes")
        argv = [
            "git", "--no-pager", "-c", "core.fsmonitor=false",
            "-c", "core.pager=cat", "-c", "i18n.logOutputEncoding=UTF-8",
            "-C", str(self.repo), *args,
        ]
        return _run_bounded(
            argv, cwd=self.repo, env=_git_environment(), timeout=self.timeout, max_bytes=limit,
        )
