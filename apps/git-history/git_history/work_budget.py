"""Context-local aggregate limits, inert for ordinary library and CLI calls."""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
import math
import threading
import time


class WorkBudgetError(RuntimeError):
    """Abort the whole job; never subclass a recoverable reader/parser error."""


class WorkCancelled(WorkBudgetError):
    """The job owner requested cancellation."""


class WorkDeadlineExceeded(WorkBudgetError):
    """Aggregate operation time expired."""


class WorkOutputLimit(WorkBudgetError):
    """Aggregate subprocess output exceeded its job allowance."""


@dataclass
class WorkBudget:
    deadline: float
    cancel: threading.Event
    max_output_bytes: int = 32 * 1024 * 1024
    output_bytes: int = field(default=0, init=False)

    def check(self) -> None:
        if self.cancel.is_set():
            raise WorkCancelled('Work cancelled.')
        if time.monotonic() >= self.deadline:
            raise WorkDeadlineExceeded('The operation exceeded its time budget.')

    def charge(self, size: int) -> None:
        self.check()
        self.output_bytes += size
        if self.output_bytes > self.max_output_bytes:
            raise WorkOutputLimit('The operation exceeded its aggregate output limit.')


_ACTIVE: ContextVar[WorkBudget | None] = ContextVar('git_history_work_budget', default=None)


def current_work_budget() -> WorkBudget | None:
    return _ACTIVE.get()


def check_work_budget() -> None:
    budget = _ACTIVE.get()
    if budget is not None:
        budget.check()


def charge_work_output(size: int) -> None:
    budget = _ACTIVE.get()
    if budget is not None:
        budget.charge(size)


@contextmanager
def work_budget(timeout: float = 45, cancel: threading.Event | None = None,
                max_output_bytes: int = 32 * 1024 * 1024):
    if (type(timeout) not in (int, float) or not math.isfinite(timeout) or timeout <= 0
            or type(max_output_bytes) is not int or max_output_bytes <= 0):
        raise ValueError('Invalid work budget.')
    budget = WorkBudget(time.monotonic() + timeout, cancel if cancel is not None else threading.Event(), max_output_bytes)
    token = _ACTIVE.set(budget)
    try:
        yield budget
    finally:
        _ACTIVE.reset(token)
