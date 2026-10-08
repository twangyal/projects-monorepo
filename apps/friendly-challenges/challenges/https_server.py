"""Bounded owned TLS connections; the accept loop never performs handshakes."""

import io
import re
import socket
import threading
import time

from . import transport as limits


class RequestError(ValueError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Connection:
    def __init__(self, runtime, sock):
        self.runtime = runtime
        self.socket = sock
        self.lock = threading.RLock()
        self.total = time.monotonic() + limits.CONNECTION_SECONDS
        self.deadline = min(self.total, time.monotonic() + limits.TLS_HANDSHAKE_SECONDS)
        self.closed = False
        self.thread = None

    def phase(self, seconds):
        with self.lock:
            self.check()
            self.deadline = min(self.total, time.monotonic() + seconds)
        self.runtime.wake()

    def check(self):
        if self.closed or time.monotonic() >= self.deadline:
            raise TimeoutError('Connection deadline exceeded.')

    def timeout(self):
        with self.lock:
            self.check()
            self.socket.settimeout(min(limits.SOCKET_IDLE_SECONDS, self.deadline - time.monotonic()))

    def close(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True
            try:
                self.socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.socket.close()


class _Reader(io.RawIOBase):
    def __init__(self, connection):
        self.connection = connection

    def readable(self):
        return True

    def readinto(self, buffer):
        self.connection.timeout()
        size = self.connection.socket.recv_into(buffer)
        self.connection.check()
        return size


class HeaderReader(io.BufferedReader):
    def __init__(self, connection):
        super().__init__(_Reader(connection), buffer_size=8192)
        self.connection = connection
        self.headers = True
        self.bytes = 0
        self.fields = 0
        self.first = True

    def readline(self, size=-1):
        self.connection.check()
        if not self.headers:
            return super().readline(size)
        remaining = limits.MAX_HEADER_BYTES - self.bytes
        line = super().readline(min(size, remaining + 1) if size >= 0 else remaining + 1)
        self.connection.check()
        self.bytes += len(line)
        if self.bytes > limits.MAX_HEADER_BYTES:
            raise RequestError(431, 'Request headers exceed the allowed size.')
        if not line:
            return line
        if not line.endswith(b'\r\n'):
            raise RequestError(400, 'Use ordinary HTTP request lines and headers.')
        value = line[:-2]
        if self.first:
            self.first = False
            if not re.fullmatch(rb'[A-Z]+ /[^\x00-\x20\x7f]* HTTP/1\.[01]', value):
                raise RequestError(400, 'Use an origin-form HTTP/1.0 or HTTP/1.1 request.')
        elif not value:
            self.headers = False
        else:
            self.fields += 1
            if self.fields > limits.MAX_HEADER_FIELDS:
                raise RequestError(431, 'Request contains too many header fields.')
            name, colon, content = value.partition(b':')
            if (not colon or not re.fullmatch(rb"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name)
                    or any(code < 32 and code != 9 or code == 127 for code in content)):
                raise RequestError(400, 'Use valid header names and values without controls.')
        return line


class DeadlineWriter(io.RawIOBase):
    def __init__(self, connection):
        self.connection = connection

    def writable(self):
        return True

    def write(self, data):
        self.connection.timeout()
        self.connection.socket.sendall(data)
        self.connection.check()
        return len(data)


class HttpsRuntime:
    def __init__(self, server, config):
        self.server = server
        self.config = config
        self.condition = threading.Condition()
        self.connections = set()
        self.threads = set()
        self.stopping = False
        self.watchdog = threading.Thread(target=self._watch, name='friendly-tls-deadlines', daemon=True)
        self.watchdog.start()

    def wake(self):
        with self.condition:
            self.condition.notify_all()

    def admit(self, request, address):
        with self.condition:
            if self.stopping or len(self.connections) >= limits.MAX_CONNECTIONS:
                request.close()
                return
            owned = Connection(self, request)
            self.connections.add(owned)
            owned.thread = threading.Thread(target=self._run, args=(owned, address),
                                            name='friendly-tls-request', daemon=True)
            try:
                owned.thread.start()
                self.threads = {thread for thread in self.threads if thread.is_alive()}
                self.threads.add(owned.thread)
            except BaseException:
                self.connections.remove(owned)
                owned.close()
                raise

    def _run(self, owned, address):
        try:
            with owned.lock:
                owned.check()
                owned.socket = self.config.ssl_context.wrap_socket(owned.socket, server_side=True,
                                                                 do_handshake_on_connect=False)
            owned.timeout()
            owned.socket.do_handshake()
            owned.check()
            owned.phase(limits.HEADER_SECONDS)
            self.server.handler_connections[owned.socket] = owned
            try:
                self.server.finish_request(owned.socket, address)
            finally:
                self.server.handler_connections.pop(owned.socket, None)
        except (OSError, ValueError, TimeoutError):
            pass
        except Exception:
            # Never log handshake/request exceptions containing credentials.
            pass
        finally:
            owned.close()
            with self.condition:
                self.connections.discard(owned)
                self.condition.notify_all()

    def _watch(self):
        while True:
            with self.condition:
                current = tuple(self.connections)
                if self.stopping and not current:
                    return
                self.condition.wait(.05)
            now = time.monotonic()
            for owned in current:
                if now >= owned.deadline:
                    owned.close()

    def stop(self):
        with self.condition:
            self.stopping = True
            current = tuple(self.connections)
            self.condition.notify_all()
        self.server.socket.close()
        for owned in current:
            owned.close()

    def join(self):
        deadline = time.monotonic() + limits.REQUEST_JOIN_SECONDS
        with self.condition:
            threads = tuple(self.threads)
        for thread in threads:
            if thread is not threading.current_thread():
                thread.join(max(0, deadline - time.monotonic()))
        with self.condition:
            if self.connections or any(thread.is_alive() for thread in threads):
                raise RuntimeError('An HTTPS request did not stop; its data directory remains locked.')
        self.watchdog.join(max(0, deadline - time.monotonic()))
        if self.watchdog.is_alive():
            raise RuntimeError('HTTPS shutdown is incomplete; its data directory remains locked.')
