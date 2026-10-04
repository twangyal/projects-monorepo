"""Explicit operator configuration for the optional private HTTPS transport."""

from dataclasses import dataclass, field
from pathlib import Path
import hashlib
import hmac
import ipaddress
import os
import re
import ssl
import stat
import sys

MAX_CONNECTIONS = 16
LISTEN_BACKLOG = 16
TLS_HANDSHAKE_SECONDS = 5.0
HEADER_SECONDS = 10.0
MAX_HEADER_BYTES = 16 * 1024
MAX_HEADER_FIELDS = 64
SOCKET_IDLE_SECONDS = 5.0
BODY_SECONDS = 15.0
RESPONSE_SECONDS = 30.0
CONNECTION_SECONDS = 75.0
REQUEST_JOIN_SECONDS = 5.0
MAX_CERT_BYTES = 128 * 1024
MAX_KEY_BYTES = 32 * 1024
MAX_SETUP_BYTES = 65


class TransportError(ValueError):
    pass


@dataclass(frozen=True)
class TransportConfig:
    bind: str
    port: int
    origin: str
    authority: str
    ssl_context: ssl.SSLContext = field(repr=False, compare=False)
    setup_digest: bytes = field(repr=False)


def _linux():
    if (not sys.platform.startswith('linux') or not callable(getattr(os, 'memfd_create', None))
            or not Path('/proc/self/fd').is_dir()):
        raise TransportError('Optional HTTPS requires Linux memfd and /proc descriptor support.')


def _address(bind, port, origin):
    if type(port) is not int or not 1 <= port <= 65535:
        raise TransportError('HTTPS requires a port between 1 and 65535.')
    try:
        address = ipaddress.IPv4Address(bind) if type(bind) is str else None
    except ipaddress.AddressValueError:
        address = None
    networks = ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8')
    if address is None or str(address) != bind or not any(address in ipaddress.IPv4Network(n) for n in networks):
        raise TransportError('Bind HTTPS to one canonical private or loopback IPv4 address.')
    if type(origin) is not str or not origin.startswith('https://') or len(origin) > 267:
        raise TransportError('Use one canonical lowercase HTTPS origin without a path.')
    authority = origin[8:]
    suffix = '' if port == 443 else ':' + str(port)
    if suffix and not authority.endswith(suffix):
        raise TransportError('The HTTPS origin must use the selected canonical port.')
    host = authority[:-len(suffix)] if suffix else authority
    if not host or len(host) > 253 or not re.fullmatch(r'[a-z0-9.-]+', host):
        raise TransportError('Use one canonical lowercase HTTPS hostname without a path.')
    try:
        host_address = ipaddress.IPv4Address(host)
    except ipaddress.AddressValueError:
        host_address = None
    if host_address is not None:
        if host != bind:
            raise TransportError('An IPv4 HTTPS origin must match the bind address.')
    elif re.fullmatch(r'[0-9]+|0x[0-9a-f]+', host.split('.')[-1]) or any(
        not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in host.split('.')
    ):
        raise TransportError('Use a canonical DNS hostname, not a numeric IPv4 alias.')
    return authority


def validate_transport(config: object, port: int) -> None:
    """Recheck the trusted runtime envelope before listener/library admission."""
    _linux()
    if (type(config) is not TransportConfig or config.port != port
            or type(config.ssl_context) is not ssl.SSLContext
            or config.ssl_context.protocol != ssl.PROTOCOL_TLS_SERVER
            or config.ssl_context.minimum_version < ssl.TLSVersion.TLSv1_2
            or type(config.setup_digest) is not bytes or len(config.setup_digest) != 32):
        raise TransportError('Use a valid prepared HTTPS configuration for the selected port.')
    if _address(config.bind, port, config.origin) != config.authority:
        raise TransportError('The configured HTTPS authority does not match its origin.')


def _file(path, limit, private):
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
        before = os.fstat(descriptor)
        if (not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= limit
                or private and (before.st_uid != os.geteuid() or stat.S_IMODE(before.st_mode) != 0o600)):
            raise TransportError('Use bounded regular TLS/setup files; private files must be owned with mode 0600.')
        parts, size = [], 0
        while True:
            chunk = os.read(descriptor, min(65536, limit + 1 - size))
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                raise TransportError('A TLS/setup input exceeds its allowed size.')
            parts.append(chunk)
        after = os.fstat(descriptor)
        if (size != before.st_size or (before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                != (after.st_size, after.st_mtime_ns, after.st_ctime_ns)):
            raise TransportError('A TLS/setup file changed while it was being read. Retry with stable files.')
        return b''.join(parts)
    except TransportError:
        raise
    except (OSError, TypeError, ValueError):
        raise TransportError('TLS/setup files must be accessible regular files without symbolic links.') from None
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _memory_file(name, data):
    # Native SSL sees only the already bounded bytes, not mutable input paths.
    descriptor = os.memfd_create(name, os.MFD_CLOEXEC)
    try:
        position = 0
        while position < len(data):
            position += os.write(descriptor, data[position:])
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def prepare_transport(*, bind: str, port: int, origin: str, tls_cert: Path,
                      tls_key: Path, setup_token_file: Path) -> TransportConfig:
    _linux()
    authority = _address(bind, port, origin)
    cert = _file(tls_cert, MAX_CERT_BYTES, False)
    key = _file(tls_key, MAX_KEY_BYTES, True)
    setup = _file(setup_token_file, MAX_SETUP_BYTES, True)
    if not re.fullmatch(b'[0-9a-f]{64}\n?', setup):
        raise TransportError('Setup key must be exactly 64 lowercase hexadecimal characters with at most one LF.')
    descriptors = []
    try:
        descriptors.append(_memory_file('friendly-cert', cert))
        descriptors.append(_memory_file('friendly-key', key))
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.set_alpn_protocols(['http/1.1'])
        context.load_cert_chain(f'/proc/self/fd/{descriptors[0]}',
                                f'/proc/self/fd/{descriptors[1]}', password=lambda: '')
    except (OSError, ValueError, AttributeError, NotImplementedError):
        raise TransportError('Load a valid unencrypted matching TLS certificate and key pair.') from None
    finally:
        for descriptor in descriptors:
            os.close(descriptor)
    return TransportConfig(bind, port, origin, authority, context, hashlib.sha256(setup[:64]).digest())


def matches_setup(config: TransportConfig, token: object) -> bool:
    return (type(config) is TransportConfig and type(config.setup_digest) is bytes
            and len(config.setup_digest) == 32 and type(token) is str
            and bool(re.fullmatch(r'[0-9a-f]{64}', token))
            and hmac.compare_digest(config.setup_digest, hashlib.sha256(token.encode('ascii')).digest()))
