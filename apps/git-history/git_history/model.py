"""Shared report contracts. Every statement is backed by local Git evidence."""

from dataclasses import dataclass, field


@dataclass
class LineEvidence:
    final_line: int
    original_line: int
    commit: str
    path: str
    author: str
    timestamp: str
    summary: str
    content: str


@dataclass
class ChangeEvidence:
    commit: str
    author: str
    date: str
    message: str
    patch: str


@dataclass
class RenameEvidence:
    commit: str
    old_path: str
    new_path: str
    similarity: int


@dataclass
class Report:
    repo_name: str
    revision: str
    requested_ref: str
    path: str
    start_line: int
    end_line: int
    source: str
    blame: list[LineEvidence] = field(default_factory=list)
    changes: list[ChangeEvidence] = field(default_factory=list)
    renames: list[RenameEvidence] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    remote_url: str | None = None
    schema_version: int = 1
