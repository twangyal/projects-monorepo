# Project verification runs

Each project owns its existing build, unit, browser and native-media checks in
`.github/workflows/`. Path filters select project push checks; a pull request's
complete changed-file set can select several project workflows. Every selected
workflow still executes all its declared checks.

The thirteen non-Gaze project workflows use workflow-level concurrency. A new
push or pull-request run supersedes an older queued/running run only within the
same workflow name, event type and Git ref. Push and PR verification remain
independent; different PR refs and ordinary distinct branch refs remain separate.
Matrix jobs share their workflow's group, so a superseded Git History run cancels
its entire Python matrix rather than allowing old versions to continue.

Explicit `workflow_dispatch` verification uses its unique GitHub run ID and does
not cancel another manual run, including a second manual run on the same ref.
An automatic run cannot cancel that manual group. This preserves deliberately
requested evidence. Gaze workflows and separately frozen experiments are outside
this change.

Use the newest run's actual checkout SHA and results when accepting work. An old
superseded run's canceled status does not establish a test failure or success.
Cancellation does not delete git commits or already published evidence; artifact
retention stays governed by the existing workflow. Jobs still need to release
their own process resources normally. Completed older runs remain in history.

GitHub concurrency groups are case-insensitive. Avoid branch/workflow names that
only differ by case: such refs share an automatic group. Existing project names
and branch names in this repository do not have that collision. GitHub does not
guarantee run ordering, so the admission/cancellation policy is not a substitute
for checking the latest commit. Runs created before a workflow gained concurrency
are not retroactively placed into its group.

This is a scheduling change, not a reduction of verification or a speed claim.
Existing steps, matrices, path filters, permissions, timeouts and artifact rules
are unchanged. GitHub's [concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
describes group scope, conditional cancellation and unique run-ID fallbacks.

Tracking and measured admission/cancellation: issue #96.
