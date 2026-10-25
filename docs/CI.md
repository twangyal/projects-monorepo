# Continuous integration

Each app has one workflow in `.github/workflows/` named after it (Shot Studio also has `shot-download-compatibility.yml`, and Gaze has `gaze-decision-benchmark.yml`). Workflows run on pushes and pull requests that touch their app's path, and on manual `workflow_dispatch`.

- **Concurrency:** in most workflows a newer push or PR run cancels an older queued or running run of the same workflow on the same ref, and manual runs are never cancelled. Exceptions: `gaze-navigator.yml` always cancels the older run, while `gaze-decision-benchmark.yml` and `shot-download-compatibility.yml` never cancel. GitHub concurrency groups are case-insensitive, so avoid branch names that differ only by case.
- **Checking results:** judge a change by the newest run on its actual commit. A cancelled, superseded run is neither a pass nor a failure.
- **Artifacts:** test reports, traces and generated media belong in workflow artifacts, not in the repository (see the documentation policy in [`AGENTS.md`](../AGENTS.md)).
