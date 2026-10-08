"""Pass owned directory handles only to media children in the current job."""
from contextlib import contextmanager
from contextvars import ContextVar

_handles = ContextVar("karaoke_media_directory_handles", default=())


def media_handles():
    return _handles.get()


@contextmanager
def inherit_media_handles(*handles):
    token = _handles.set(tuple(handles))
    try:
        yield
    finally:
        _handles.reset(token)
