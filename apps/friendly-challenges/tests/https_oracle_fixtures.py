"""Original test CA and literal network fixture; never imports transport producers."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import socket
import ssl
import subprocess


def reserve_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def certificates(root: Path):
    root.mkdir(mode=0o700)

    def run(*args):
        subprocess.run(['openssl', *args], cwd=root, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)

    def key(name):
        path = root / name
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
        run('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
            '-out', name)
        path.chmod(0o600)

    key('ca.key')
    run('req', '-new', '-x509', '-key', 'ca.key', '-out', 'ca.pem', '-days', '3',
        '-subj', '/CN=Independent Friendly Oracle CA', '-addext', 'basicConstraints=critical,CA:TRUE',
        '-addext', 'keyUsage=critical,keyCertSign,cRLSign')
    (root / 'index').write_text('')
    (root / 'serial').write_text('0100\n')
    (root / 'issued').mkdir()
    key('server.key')
    run('req', '-new', '-key', 'server.key', '-out', 'server.csr',
        '-subj', '/CN=Independent Friendly Oracle Leaf')
    now = datetime.now(timezone.utc)
    for name, san, expired in [('valid', 'IP:127.0.0.1', False),
                               ('wrong-san', 'DNS:unrelated.invalid', False),
                               ('expired', 'IP:127.0.0.1', True)]:
        (root / 'ca.cnf').write_text(
            '[ca]\ndefault_ca=oracle\n[oracle]\ndatabase=index\nserial=serial\n'
            'new_certs_dir=issued\ncertificate=ca.pem\nprivate_key=ca.key\n'
            'default_md=sha256\npolicy=policy\nunique_subject=no\nx509_extensions=leaf\n'
            '[policy]\ncommonName=supplied\n[leaf]\nbasicConstraints=critical,CA:FALSE\n'
            'keyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n'
            f'subjectAltName={san}\n')
        start = '20000101000000Z' if expired else (now-timedelta(days=1)).strftime('%Y%m%d%H%M%SZ')
        end = '20010101000000Z' if expired else (now+timedelta(days=1)).strftime('%Y%m%d%H%M%SZ')
        run('ca', '-batch', '-config', 'ca.cnf', '-in', 'server.csr', '-out', name+'.pem',
            '-startdate', start, '-enddate', end, '-notext')
    return root


def trusted_context(root):
    context = ssl.create_default_context(cafile=str(root / 'ca.pem'))
    context.set_alpn_protocols(['http/1.1'])
    return context


def wire_request(authority, method='GET', path='/api/status', fields=(), body=b''):
    lines = [f'{method} {path} HTTP/1.1', f'Host: {authority}', *fields]
    return ('\r\n'.join(lines)+'\r\n\r\n').encode('ascii') + body


def receive(sock):
    chunks = []
    total = 0
    while True:
        try:
            chunk = sock.recv(65536)
        except (ConnectionResetError, ssl.SSLError):
            break
        if not chunk:
            break
        total += len(chunk)
        if total > 9 * 1024 * 1024:
            raise AssertionError('Oracle response exceeded independent bounded read')
        chunks.append(chunk)
    return b''.join(chunks)


def split_response(data):
    head, _, body = data.partition(b'\r\n\r\n')
    lines = head.split(b'\r\n')
    status = int(lines[0].split(b' ')[1]) if lines and lines[0].startswith(b'HTTP/') else 0
    return status, lines[1:], body


def original_terms():
    return dict(title='Original library sprint Ω', description='Walk the marked original loop',
                successCriteria='Opponent records two completed laps',
                evidenceRule='Retain the reviewed finish photo', stake='bragging-rights',
                deadline=1900000060000)


def original_jpeg():
    from io import BytesIO
    from PIL import Image
    output = BytesIO()
    Image.new('RGB', (31, 19), (211, 37, 89)).save(output, 'JPEG', quality=88)
    return output.getvalue()


def image_frame(metadata, jpeg):
    import json
    import struct
    raw = json.dumps(metadata, ensure_ascii=False, separators=(',', ':')).encode()
    return b'FCEVID01'+struct.pack('<II', len(raw), len(jpeg))+raw+jpeg
