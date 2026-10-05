"""Independent original changed-tree maximum, installed-wheel and native handoff proof.

No producer imports or persistent-service ownership. Root executes phases deliberately.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

APP = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
       "GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_COUNT": "0", "GIT_OPTIONAL_LOCKS": "0"}
SPECIAL = "literal/tab\tnewline\nユニ.txt"
SELECTED = "bulk/file-00101.txt"


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def blob_id(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def command(argv, *, cwd, data=None, env=None, success=True):
    result = subprocess.run(argv, cwd=cwd, input=data, capture_output=True,
                            env=env or ENV, timeout=60, check=False)
    require(len(result.stdout) + len(result.stderr) <= 16 * 1024 * 1024,
            "Independent subprocess output exceeded16MiB")
    if success:
        require(result.returncode == 0, "Independent subprocess refused its explicit phase")
    return result


def git(repo, *args, data=None):
    return command(["git", "-C", str(repo), *args], cwd=repo.parent, data=data).stdout


def original_trees():
    left = {f"bulk/file-{i:05d}.txt": f"Original common line\nleft {i:05d}\n".encode()
            for i in range(9997)}
    left["src/selected.txt"] = b"Original common line\nleft source\n"
    left["unchanged.txt"] = b"Literal unchanged committed control\n"
    right = {path: data.replace(b"\nleft ", b"\nright ") for path, data in left.items()}
    right["src-extra/neighbor.txt"] = b"Exact directory neighbor, not a src child\n"
    right[SPECIAL] = b"Literal tab newline Unicode path\n"
    return left, right


def fast_import(repo, left, right):
    stream = bytearray()
    next_mark = 100
    marks = {}
    for tree in [left, right, {"overflow/one-more.txt": b"Entry ten thousand and one\n"}]:
        for path, data in tree.items():
            if data not in marks:
                marks[data] = next_mark
                stream.extend(f"blob\nmark :{next_mark}\ndata {len(data)}\n".encode())
                stream.extend(data + b"\n")
                next_mark += 1
    for index, (ref, tree) in enumerate([("max-left", left), ("max-right", right),
                                       ("max-overflow", {"overflow/one-more.txt":
                                                         b"Entry ten thousand and one\n"})], 1):
        stream.extend(f"commit refs/heads/{ref}\nmark :{index}\n".encode())
        stream.extend(b"author Original Maximum Fixture <fixture@example.invalid> 1700000000 +0000\n")
        stream.extend(b"committer Original Maximum Fixture <fixture@example.invalid> 1700000000 +0000\n")
        stream.extend(b"data 17\nLiteral tree test\n")
        if index > 1:
            stream.extend(f"from :{index - 1}\n".encode())
        for path, data in sorted(tree.items(), key=lambda item: item[0].encode()):
            stream.extend(f"M 100644 :{marks[data]} {json.dumps(path, ensure_ascii=False)}\n".encode())
        stream.extend(b"\n")
    git(repo, "fast-import", "--quiet", data=bytes(stream))


def endpoint(data):
    return {"kind": "regular", "mode": "100644", "object_id": blob_id(data)}


def expected_entries(left, right):
    return [{"path": path, "change": "modified" if path in left else "added",
             "left": endpoint(left[path]) if path in left else None,
             "right": endpoint(right[path]), "addressable": True}
            for path in sorted(right, key=lambda p: p.encode()) if left.get(path) != right[path]]


def fingerprint(repo):
    # Hash only owned fixture worktree/index; never changes the monorepo.
    files = []
    for file in sorted(repo.rglob("*")):
        if ".git" not in file.relative_to(repo).parts and file.is_file():
            data = file.read_bytes()
            files.append({"path": file.relative_to(repo).as_posix(),
                          "bytes": len(data), "sha256": digest(data)})
    return {"indexSha256": digest((repo / ".git/index").read_bytes()),
            "worktreeSha256": digest(encode(files)), "worktreeFiles": len(files),
            "statusSha256": digest(git(repo, "status", "--porcelain=v1", "-z"))}


def prepare(out):
    out.mkdir(mode=0o700, parents=False, exist_ok=False)
    repo = out / "repository"
    repo.mkdir()
    git(repo, "init", "-q", "--object-format=sha1", "--initial-branch=main")
    git(repo, "config", "user.name", "Original Maximum Fixture")
    git(repo, "config", "user.email", "fixture@example.invalid")
    git(repo, "config", "diff.renames", "true")
    git(repo, "config", "diff.external", "/nonexistent-original-fixture-diff")
    left, right = original_trees()
    fast_import(repo, left, right)
    revisions = {name: git(repo, "rev-parse", name).decode().strip()
                 for name in ["max-left", "max-right", "max-overflow"]}
    git(repo, "symbolic-ref", "HEAD", "refs/heads/max-right")
    git(repo, "reset", "--hard", "-q", "max-right")
    (repo / SELECTED).write_bytes(b"DIRTY WORKTREE MUST NOT BECOME COMMITTED SOURCE\n")
    (repo / "unchanged.txt").write_bytes(b"STAGED PRIVATE FIXTURE CONTROL\n")
    git(repo, "add", "--", "unchanged.txt")
    (repo / "untracked-control.txt").write_bytes(b"Untouched original untracked bytes\n")
    entries = expected_entries(left, right)
    require(len(entries) == 10000, "Literal maximum changed-path arithmetic")
    pins = fingerprint(repo)
    expected = {"schema_version": 1, "kind": "changed-file-catalog", "repo_name": "repository",
                "left_requested_ref": "max-left", "left_revision": revisions["max-left"],
                "right_requested_ref": "max-right", "right_revision": revisions["max-right"],
                "directory": "", "entries": entries, "omitted_non_utf8_paths": 0}
    (out / "expected-catalog.json").write_bytes(encode(expected))
    facts = {"schemaVersion": 1, "issue": 123, "revisions": revisions,
             "maximumRawEntries": 10000, "overflowRawEntries": 10001,
             "unchangedExcluded": "unchanged.txt", "literalControlPath": SPECIAL,
             "selectedPath": SELECTED, "selectedLeftSource": left[SELECTED].decode(),
             "selectedRightSource": right[SELECTED].decode(),
             "selectedLeftBlob": blob_id(left[SELECTED]),
             "selectedRightBlob": blob_id(right[SELECTED]),
             "originalState": pins, "expectedCatalogSha256": digest(encode(expected)),
             "limits": ["Count maximum uses small original paths/blobs and remains below tighter raw-output byte bounds.",
                        "No2MiB raw-output or8MiB serialized catalog saturation claim.",
                        "Literal tab/newline/Unicode path is separate semantic fidelity, not a long-path maximum.",
                        "No optional native parser, network fetch or inspected-source execution required."]}
    (out / "fixture-oracle.json").write_bytes(encode(facts))
    print(json.dumps({"status": "prepared", "output": str(out), "entries": len(entries),
                      "expectedCatalogSha256": facts["expectedCatalogSha256"]}))


def cli(python, out, args, source):
    env = {**ENV, "PYTHONPATH": str(APP) if source else ""}
    argv = [python, *([] if source else ["-I"]), "-m", "git_history", *args]
    return command(argv, cwd=out, env=env, success=False)


def verify(out, source_python, installed_python):
    start = time.monotonic()
    oracle = json.loads((out / "fixture-oracle.json").read_bytes())
    expected = json.loads((out / "expected-catalog.json").read_bytes())
    require(digest((out / "expected-catalog.json").read_bytes()) ==
            oracle["expectedCatalogSha256"], "Original expected catalog changed")
    repo = out / "repository"
    require(fingerprint(repo) == oracle["originalState"], "Original fixture state changed")
    wheel = command([installed_python, "-I", "-c",
                     "import importlib.util,json,git_history;print(json.dumps({'module':git_history.__file__,'tree_sitter':importlib.util.find_spec('tree_sitter') is not None}))"], cwd=out)
    module = json.loads(wheel.stdout)
    require(not module["tree_sitter"] and "site-packages" in module["module"],
            "Require freshly installed optional-parser-free wheel")
    scenarios = [("maximum", "max-right", "", expected),
                 ("src", "max-right", "src", {**expected, "directory": "src",
                   "entries": [e for e in expected["entries"] if e["path"].startswith("src/")]}),
                 ("same", "max-left", "", {**expected, "right_requested_ref": "max-left",
                   "right_revision": oracle["revisions"]["max-left"], "entries": []})]
    outputs = []
    for name, right, directory, want in scenarios:
        args = ["changes", "--repo", str(repo), "--left-ref", "max-left", "--right-ref",
                right, "--directory", directory, "--format", "json"]
        source = cli(source_python, out, args, True)
        installed = cli(installed_python, out, args, False)
        require(source.returncode == installed.returncode == 0, "Catalog source/wheel refused")
        require(source.stdout == installed.stdout, "Source/wheel catalog byte mismatch")
        require(json.loads(source.stdout) == want, "Original full path/blob catalog mismatch")
        (out / f"{name}-cli.json").write_bytes(installed.stdout)
        outputs.append({"name": name, "bytes": len(installed.stdout),
                        "sha256": digest(installed.stdout), "entries": len(want["entries"])})
    refusals = []
    for python, source in [(source_python, True), (installed_python, False)]:
        result = cli(python, out, ["changes", "--repo", str(repo), "--left-ref", "max-left",
                     "--right-ref", "max-overflow", "--format", "json"], source)
        require(result.returncode != 0 and not result.stdout.strip(),
                "10,001 entries must refuse without partial authoritative JSON")
        refusals.append({"mode": "source" if source else "installed", "exit": result.returncode})
    for fmt in ["json", "html"]:
        args = ["compare", "--repo", str(repo), "--left-ref", oracle["revisions"]["max-left"],
                "--right-ref", oracle["revisions"]["max-right"], "--left-file", SELECTED,
                "--right-file", SELECTED, "--left-whole", "--right-whole", "--format", fmt]
        source, installed = cli(source_python, out, args, True), cli(installed_python, out, args, False)
        require(source.returncode == installed.returncode == 0 and source.stdout == installed.stdout,
                "Source/wheel exact selected comparison parity failed")
        (out / f"selected-comparison.{fmt}").write_bytes(installed.stdout)
        if fmt == "json":
            report = json.loads(installed.stdout)
            require(report["left"]["source"] == oracle["selectedLeftSource"] and
                    report["right"]["source"] == oracle["selectedRightSource"],
                    "Comparison must contain original committed source, not dirty worktree")
            require([report[k] for k in ["unchanged_lines", "removed_lines", "added_lines"]]
                    == [1, 1, 1], "Original scalar line alignment")
    require(fingerprint(repo) == oracle["originalState"], "CLI modified worktree/index")
    receipt = {"schemaVersion": 1, "issue": 123, "status": "passed",
               "scriptSha256": digest(Path(__file__).read_bytes()),
               "fixtureOracleSha256": digest((out / "fixture-oracle.json").read_bytes()),
               "catalogs": outputs, "overflowRefusals": refusals,
               "installedOptionalParser": False, "worktreeIndexByteIdentity": True,
               "originalTreeFacts": oracle, "wallMs": (time.monotonic() - start) * 1000}
    (out / "cli-verification.json").write_bytes(encode(receipt))
    print(json.dumps({"status": "passed", "catalogs": outputs, "wallMs": receipt["wallMs"]}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=["prepare", "verify", "audit"])
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source-python", default=sys.executable)
    parser.add_argument("--installed-python")
    args = parser.parse_args()
    out = args.output.resolve()
    if args.phase == "prepare":
        prepare(out)
    elif args.phase == "audit":
        oracle = json.loads((out / "fixture-oracle.json").read_bytes())
        require(fingerprint(out / "repository") == oracle["originalState"],
                "Final browser/CLI audit changed fixture worktree/index")
        proof = {"schemaVersion": 1, "issue": 123, "status": "passed",
                 "worktreeIndexByteIdentity": True,
                 "originalState": oracle["originalState"]}
        (out / "final-readonly-audit.json").write_bytes(encode(proof))
        print(json.dumps({"status": "passed", "worktreeIndexByteIdentity": True}))
    else:
        require(args.installed_python, "Supply root's fresh wheel environment Python")
        verify(out, args.source_python, args.installed_python)


if __name__ == "__main__":
    main()
