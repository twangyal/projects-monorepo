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
class FunctionDefinition:
    qualified_name: str
    start_line: int
    end_line: int
    kind: str


@dataclass
class FunctionCatalog:
    repo_name: str
    revision: str
    requested_ref: str
    path: str
    functions: list[FunctionDefinition]


@dataclass
class SourceFile:
    path: str
    language: str
    size_bytes: int


@dataclass
class FileCatalog:
    repo_name: str
    revision: str
    requested_ref: str
    directory: str
    language: str
    files: list[SourceFile]
    omitted_non_utf8_paths: int = 0


@dataclass(frozen=True)
class RevisionSnapshot:
    """One guarded committed revision and its original request label."""
    repo_name: str
    revision: str
    requested_ref: str


@dataclass(frozen=True)
class SourceSnapshot:
    """Exact bounded committed text with Git's physical LF line count."""
    repo_name: str
    revision: str
    requested_ref: str
    path: str
    source: str
    line_count: int


@dataclass
class ContextEntry:
    """Unverified supplied text, associated only with an existing report commit."""
    commit: str
    source: str
    url: str
    author: str
    excerpt: str


@dataclass
class SuppliedContext:
    """A revision-bound, unverified discussion record supplied by the user."""
    commit: str
    url: str
    title: str
    author: str
    excerpt: str


@dataclass
class RetrievedComment:
    kind: str  # 'file-review-comment', 'review', 'conversation'
    author: str
    url: str
    created_at: str
    excerpt: str
    truncated: bool
    path: str | None = None
    line: int | None = None


@dataclass
class RetrievedIssue:
    number: int
    url: str
    title: str
    author: str
    state: str
    excerpt: str
    truncated: bool


@dataclass
class RetrievedPull:
    number: int
    url: str
    title: str
    author: str
    state: str
    merged_at: str | None
    created_at: str
    commits: list[str]
    description: str
    description_truncated: bool
    comments: list[RetrievedComment] = field(default_factory=list)
    linked_issues: list[RetrievedIssue] = field(default_factory=list)
    omitted_comments: int = 0


@dataclass
class RetrievedDiscussions:
    provider: str
    repository: str
    retrieved_at: str
    provenance: str
    commits_checked: list[str]
    commits_without_pulls: list[str]
    pulls: list[RetrievedPull]
    notes: list[str]


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
    selected_function: str | None = None
    supplied_context: list[SuppliedContext] | None = None
    retrieved_discussions: RetrievedDiscussions | None = None
