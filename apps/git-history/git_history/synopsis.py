"""Factual report summaries derived solely from the embedded Git evidence."""

from dataclasses import asdict
from urllib.parse import quote

from .model import Report

MAX_MESSAGE_EXCERPT = 240
MAX_RECENT_CHANGES = 3


def commit_anchor(commit: str) -> str:
    return "commit-" + quote(commit, safe="")


def build_synopsis(report: Report) -> dict:
    """Summarize observations, preserving Git's existing range-change order."""
    attribution = {}
    for line in report.blame:
        if line.commit not in attribution:
            attribution[line.commit] = {
                "commit": line.commit, "line_count": 0, "author": line.author,
                "summary": line.summary, "evidence_anchor": commit_anchor(line.commit),
            }
        attribution[line.commit]["line_count"] += 1

    recent_changes = [
        {
            "commit": change.commit, "author": change.author, "date": change.date,
            "message_excerpt": change.message[:MAX_MESSAGE_EXCERPT],
            "message_truncated": len(change.message) > MAX_MESSAGE_EXCERPT,
            "evidence_anchor": commit_anchor(change.commit),
        }
        for change in report.changes[:MAX_RECENT_CHANGES]
    ]
    renames = [
        {**asdict(rename), "evidence_anchor": commit_anchor(rename.commit)}
        for rename in report.renames
    ]
    notes = list(report.warnings)
    if not notes:
        notes.append("No additional completeness warnings were reported within the configured limits.")
    if not report.blame:
        notes.append("No current-line attribution was returned for the selected range.")
    if not report.changes:
        notes.append("No range-change records were returned; the range timeline is unavailable.")
    elif len(report.changes) > MAX_RECENT_CHANGES:
        notes.append(
            f"This synopsis shows 3 of {len(report.changes)} available range-change records; "
            "the change timeline contains the other returned records."
        )
    if not report.renames:
        notes.append("No whole-file rename evidence was returned within the history limit.")
    notes.append(
        "Available records are bounded Git observations, not proof of complete semantic history "
        "or of the selected range's introduction. Whole-file rename similarity is heuristic "
        "and does not establish function continuity."
    )
    return {
        "selection": {
            "path": report.path, "start_line": report.start_line, "end_line": report.end_line,
            "selected_function": report.selected_function,
            "revision": report.revision, "requested_ref": report.requested_ref,
        },
        "attribution": list(attribution.values()), "recent_changes": recent_changes,
        "renames": renames, "completeness_notes": notes,
        "intent_note": (
            "Author intent remains unknown to this report. Commit messages are quoted author "
            "statements, not verified reasoning; patches do not establish causation. "
            "PR and issue discussions were not fetched."
        ),
    }
