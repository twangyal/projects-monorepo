#!/usr/bin/env python3
"""Real no-model cross-library archive/restart/media smoke.

Run with the application's core Python environment. Default audio is original
synthetic stereo PCM, not a separation-quality fixture. --source-project copies
only fixed saved files from an existing project; originals are never changed.
The 300-second run is intentionally opt-in and should be scheduled separately.
"""
from __future__ import annotations

import argparse
import array
import hashlib
import html
import http.client
import json
import math
import os
from pathlib import Path
import resource
import selectors
import shutil
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time
import wave
import zlib

APP = Path(__file__).resolve().parents[1]
AUDIO_NAMES = ('source.wav', 'vocals.wav', 'backing.wav')
BLOCK = 65536


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(BLOCK), b''):
            result.update(block)
    return result.hexdigest()


def file_facts(directory: Path) -> dict:
    return {p.name: dict(bytes=p.stat().st_size, sha256=digest(p))
            for p in sorted(directory.iterdir()) if p.is_file() and not p.is_symlink()}


def scratch_bytes(directory: Path) -> int:
    """Sample owned scratch; concurrent cleanup may remove a queued entry."""
    pending, total = [directory], 0
    while pending:
        folder = pending.pop()
        try:
            with os.scandir(folder) as entries:
                for entry in entries:
                    try:
                        info = entry.stat(follow_symlinks=False)
                    except FileNotFoundError:
                        continue
                    if stat.S_ISDIR(info.st_mode):
                        pending.append(Path(entry.path))
                    elif stat.S_ISREG(info.st_mode):
                        total += info.st_size
        except FileNotFoundError:
            # Only expected disappearance is ignored. Permissions, IO errors
            # and every other failure still surface as meaningful failures.
            continue
    return total


def wav_facts(path: Path) -> dict:
    size = path.stat().st_size
    with path.open('rb') as source:
        fields = struct.unpack('<4sI4s4sIHHIIHH4sI', source.read(44))
        frames = (size - 44) // 4
        expected = (b'RIFF', size - 8, b'WAVE', b'fmt ', 16, 1, 2, 44100,
                    176400, 4, 16, b'data', frames * 4)
        assert fields == expected and 44100 <= frames <= 13230000
        assert size == 44 + frames * 4
        samples = {}
        for index in (0, 440, 441, frames // 2, frames - 1):
            source.seek(44 + index * 4)
            samples[str(index)] = list(struct.unpack('<hh', source.read(4)))
    return dict(bytes=size, frames=frames, samples=samples, sha256=digest(path))


def inspect_archive(path: Path) -> dict:
    """Independent literal header/table checks and streamed CRC/SHA, no engine."""
    total = path.stat().st_size
    assert 22 <= total <= 160 * 1024**2
    with path.open('rb') as source:
        source.seek(total - 22)
        e = struct.unpack('<IHHHHIIH', source.read(22))
        assert e[:3] == (0x06054B50, 0, 0) and e[3] == e[4] and e[7] == 0
        assert e[3] in (5, 6) and e[5] <= 4096 and e[6] + e[5] == total - 22
        cursor, local_end, records, metadata = e[6], 0, [], {}
        for _ in range(e[3]):
            source.seek(cursor)
            c = struct.unpack('<IHHHHHHIIIHHHHHII', source.read(46))
            assert c[:7] == (0x02014B50, 788, 20, 0, 0, 0, 33)
            assert c[8] == c[9] and c[11:15] == (0, 0, 0, 0)
            assert c[15] == (stat.S_IFREG | 0o600) << 16 and c[16] == local_end
            name = source.read(c[10])
            source.seek(local_end)
            local = struct.unpack('<IHHHHHIIIHH', source.read(30))
            assert local[:6] == (0x04034B50, 20, 0, 0, 0, 33)
            assert local[6:9] == c[7:10] and local[9] == len(name) and local[10] == 0
            assert source.read(local[9]) == name
            offset, remaining = source.tell(), c[9]
            sha, crc, data = hashlib.sha256(), 0, bytearray()
            text = name.endswith(b'.json')
            if text:
                limit = {'project.json': 256 * 1024, 'processing.json': 16384, 'manifest.json': 8192}[name.decode()]
                assert remaining <= limit
            while remaining:
                block = source.read(min(BLOCK, remaining))
                assert block
                sha.update(block)
                crc = zlib.crc32(block, crc)
                if text:
                    data.extend(block)
                remaining -= len(block)
            assert crc == c[7]
            records.append(dict(name=name.decode('ascii'), bytes=c[9], sha256=sha.hexdigest()))
            if text:
                metadata[name.decode()] = json.loads(data.decode('utf-8'))
            else:
                source.seek(offset)
                h = struct.unpack('<4sI4s4sIHHIIHH4sI', source.read(44))
                n = (c[9] - 44) // 4
                assert h == (b'RIFF', c[9] - 8, b'WAVE', b'fmt ', 16, 1, 2, 44100,
                             176400, 4, 16, b'data', n * 4)
                assert c[9] == 44 + n * 4
            local_end = offset + c[9]
            cursor += 46 + len(name)
        assert local_end == e[6] and cursor == total - 22
    names = ['project.json', *AUDIO_NAMES]
    assert [r['name'] for r in records] in (names + ['manifest.json'], names + ['processing.json', 'manifest.json'])
    manifest = metadata['manifest.json']
    assert manifest['files'] == records[:-1]
    frames = (next(r['bytes'] for r in records if r['name'] == 'source.wav') - 44) // 4
    assert manifest['audio'] == dict(sampleRate=44100, channels=2, sampleWidth=2, frames=frames)
    assert metadata['project.json']['duration'] == frames / 44100
    assert all(next(r['bytes'] for r in records if r['name'] == name) == 44 + frames * 4 for name in AUDIO_NAMES)
    return dict(bytes=total, sha256=digest(path), manifest=manifest,
                project=metadata['project.json'], members=records)


def serve_library(directory: Path):
    # This is the actual service/engine/video pipeline. Only unavailable model
    # readiness and the forbidden inference callback are explicit test hooks.
    sys.path.insert(0, str(APP))
    from karaoke.server import create_server

    def forbidden(*_):
        (directory / 'INFERENCE-WAS-CALLED').write_text('Unexpected separation call')
        raise RuntimeError('Archive smoke must never invoke inference.')

    server = create_server(directory, directory / 'absent-model', 0, separate=forbidden, ready=lambda _: False)

    def stop(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    print(json.dumps(dict(port=server.server_port, pid=os.getpid())), flush=True)
    try:
        server.serve_forever(poll_interval=0.05)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


class Service:
    def __init__(self, library: Path):
        self.library = library
        self.scratch_peak = 0
        self.rss_peak_kib = 0
        self.process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()),
                                         '--serve-library', str(library)],
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        selector = selectors.DefaultSelector()
        try:
            assert self.process.stdout is not None
            selector.register(self.process.stdout, selectors.EVENT_READ)
            assert selector.select(15), 'Service did not start within 15s'
            value = json.loads(self.process.stdout.readline(4096))
            self.port, self.pid = value['port'], value['pid']
            session = self.request('GET', '/api/session')
            assert session['modelReady'] is False and session['maxArchiveBytes'] == 167772160
            self.token = session['token']
        except BaseException:
            # A failed constructor is not yet in the parent's cleanup list.
            self.process.terminate()
            try:
                self.process.communicate(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.communicate()
            raise
        finally:
            selector.close()

    def observe(self):
        jobs = self.library / '.jobs'
        size = scratch_bytes(jobs)
        self.scratch_peak = max(self.scratch_peak, size)
        try:
            status = Path(f'/proc/{self.pid}/status').read_text()
            value = next(line for line in status.splitlines() if line.startswith('VmHWM:'))
            self.rss_peak_kib = max(self.rss_peak_kib, int(value.split()[1]))
        except (OSError, StopIteration):
            pass

    def request(self, method: str, route: str, value=None, *, upload: Path | None = None):
        headers, body = {}, None
        if method not in ('GET', 'HEAD'):
            headers.update({'Origin': f'http://127.0.0.1:{self.port}', 'X-Karaoke-Token': self.token})
            if upload is None:
                body = json.dumps({} if value is None else value, ensure_ascii=False).encode('utf-8')
                headers['Content-Type'] = 'application/json'
            else:
                headers['Content-Type'] = 'application/zip'
                headers['Content-Length'] = str(upload.stat().st_size)
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=65)
        try:
            if upload is None:
                connection.request(method, route, body, headers)
            else:
                with upload.open('rb') as source:
                    connection.request(method, route, source, headers)
            response = connection.getresponse()
            raw = response.read(1024 * 1024 + 1)
            assert len(raw) <= 1024 * 1024
            result = json.loads(raw)
            assert response.status in (200, 202), f'{method} {route}: {response.status}: {result}'
            return result
        finally:
            connection.close()

    def download(self, route: str, output: Path, limit: int):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=65)
        try:
            connection.request('GET', route)
            response = connection.getresponse()
            assert response.status == 200, f'Download failed: {route}: {response.status}'
            copied = 0
            with output.open('xb') as target:
                while block := response.read(BLOCK):
                    copied += len(block)
                    assert copied <= limit
                    target.write(block)
            assert copied == int(response.getheader('Content-Length'))
            return copied
        finally:
            connection.close()

    def job(self, initial: dict, timeout: float = 185, *, statuses=('complete',)):
        current = initial['job']
        deadline = time.monotonic() + timeout
        while current['status'] == 'running':
            assert time.monotonic() < deadline, 'Job deadline exceeded'
            self.observe()
            time.sleep(0.025)
            current = self.request('GET', '/api/jobs/' + current['id'])['job']
        self.observe()
        assert current['status'] in statuses, current
        assert self.request('GET', '/api/session')['activeJob'] is None
        assert not any((self.library / '.jobs').iterdir()), 'Terminal job retained scratch files'
        return current

    def close(self):
        try:
            self.observe()
        finally:
            # Even a meaningful observer failure must reap this owned process.
            if self.process.poll() is None:
                self.process.terminate()
            try:
                _, errors = self.process.communicate(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.communicate()
                raise AssertionError('Service shutdown exceeded 15s') from None
            assert self.process.returncode == 0, f'Service failed: {errors[:1000]}'
            assert not (self.library / 'INFERENCE-WAS-CALLED').exists()


def make_fixture(directory: Path, duration: float):
    frames = round(duration * 44100)
    duration = frames / 44100
    directory.mkdir(parents=True)
    for index, name in enumerate(AUDIO_NAMES):
        with wave.open(str(directory / name), 'wb') as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(44100)
            for start in range(0, frames, 441):
                block = bytearray()
                for n in range(start, min(start + 441, frames)):
                    left = round(11000 * math.sin(2 * math.pi * (220 + 110 * index) * n / 44100))
                    right = round(8000 * math.sin(2 * math.pi * (330 + 110 * index) * n / 44100))
                    block += struct.pack('<hh', left, right)
                output.writeframesraw(block)
    early_span = duration - min(0.75, duration * 0.5)
    cues = [dict(start=i * early_span / 200, end=(i + 0.7) * early_span / 200,
                 text=f'Original literal café <line {i + 1}> & {{100%}}\n声') for i in range(199)]
    cues.append(dict(start=duration - min(0.5, duration * 0.25), end=duration,
                     text='Final literal café <last> & {100%}\n声'))
    record = dict(schemaVersion=1, id=directory.name, title='Archive smoke — original café <title>',
                  duration=duration, revision=7, cues=cues)
    (directory / 'project.json').write_text(json.dumps(record, ensure_ascii=False), encoding='utf-8')
    (directory / 'processing.json').write_bytes(b'{}\n')


def expected_srt(project: dict) -> bytes:
    def timestamp(value):
        ms = math.floor(value * 1000 + 0.5)
        return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}'
    lines = []
    for i, cue in enumerate(project['cues']):
        start = math.floor(cue['start'] * 1000 + 0.5)
        end = max(start + 1, math.floor(cue['end'] * 1000 + 0.5))
        text = '\n'.join(line for line in html.escape(cue['text'], quote=False).splitlines() if line.strip())
        lines.append(f'{i + 1}\n{timestamp(start / 1000)} --> {timestamp(end / 1000)}\n{text}\n')
    return ('\n'.join(lines)).encode('utf-8')


def bounded_tool(command: list[str], cap: int, timeout=120, *, input_bytes=None) -> bytes:
    output = subprocess.run(command, input=input_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=timeout, check=False)
    assert output.returncode == 0, output.stderr[:1000].decode('utf-8', errors='replace')
    assert len(output.stdout) <= cap
    return output.stdout


class GlyphLayoutUnsupported(ValueError):
    """The optional exact-final-line oracle cannot model this fixture layout."""


def glyph_reference(text: str, color: tuple[int, int, int]) -> dict:
    """Independent declared 44px explicit-line card geometry and 4:2:0 colors.

    This fixture oracle intentionally refuses automatic wrapping/shrinking;
    the default fixture and supplied full-song fixture have explicit short
    lines. No production card renderer or expected-image output is imported.
    """
    from PIL import Image, ImageDraw, ImageFilter, ImageFont

    font = ImageFont.truetype(str(APP / 'assets' / 'DejaVuSans.ttf'), 44)
    lines = [' '.join(line.split()) for line in text.replace('\r\n', '\n').replace('\r', '\n').split('\n')]
    if not (1 <= len(lines) <= 5 and any(lines) and all(font.getlength(line) <= 1000 for line in lines)):
        raise GlyphLayoutUnsupported('Exact final glyph oracle requires 1–5 explicit lines fitting 1000px at44px.')
    mask = Image.new('L', (1280, 720), 0)
    reference = Image.new('RGB', (1280, 720), (20, 35, 47))
    for index, line in enumerate(lines):
        center = (640, 320 + (index - (len(lines) - 1) / 2) * 55)
        ImageDraw.Draw(mask).text(center, line, font=font, anchor='mm', fill=255)
        ImageDraw.Draw(reference).text(center, line, font=font, anchor='mm', fill=color)
    # Model the declared yuv420p subsampling, not an additional H264 encode.
    common = ['ffmpeg', '-v', 'error', '-threads', '1', '-filter_threads', '1',
              '-f', 'rawvideo', '-video_size', '1280x720']
    yuv = bounded_tool(common + ['-pixel_format', 'rgb24', '-i', 'pipe:0', '-frames:v', '1',
                                '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'],
                       1280 * 720 * 3 // 2, timeout=10, input_bytes=reference.tobytes())
    assert len(yuv) == 1280 * 720 * 3 // 2
    rgb = bounded_tool(common + ['-pixel_format', 'yuv420p', '-i', 'pipe:0', '-frames:v', '1',
                                '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
                       1280 * 720 * 3, timeout=10, input_bytes=yuv)
    assert len(rgb) == 1280 * 720 * 3
    return dict(mask=mask.tobytes(), dilated=mask.filter(ImageFilter.MaxFilter(5)).tobytes(),
                rgb=rgb, bounds=list(mask.getbbox()))


def negative_glyph_text(final_text: str) -> str:
    # A supplied legitimate cue may itself contain the usual control phrase.
    usual = 'Wrong unrelated words'
    return 'Entirely different fixture' if ' '.join(final_text.split()) == usual else usual


def glyph_facts(frame: memoryview, reference: dict) -> dict:
    core = matching = foreground = contained = 0
    for y in range(170, 470):
        for x in range(120, 1160):
            pixel = y * 1280 + x
            offset = pixel * 3
            if reference['mask'][pixel] >= 240:
                core += 1
                matching += all(abs(frame[offset + channel] - reference['rgb'][offset + channel]) <= 35
                                for channel in range(3))
            if frame[offset] > 100:
                foreground += 1
                contained += reference['dilated'][pixel] > 0
    assert core > 0
    coverage = matching / core
    precision = contained / foreground if foreground else 0
    return dict(passed=coverage >= 0.9 and precision >= 0.95, expectedCorePixels=core,
                matchingCorePixels=matching, coreCoverage=coverage,
                actualForegroundPixels=foreground, expectedMaskForegroundPixels=contained,
                spatialPrecision=precision, expectedBounds=reference['bounds'])


def inspect_video(path: Path, record: dict) -> dict:
    probe = json.loads(bounded_tool(['ffprobe', '-v', 'error', '-show_streams', '-show_format',
                                    '-of', 'json', str(path)], 262144))
    video = next(stream for stream in probe['streams'] if stream['codec_type'] == 'video')
    audio = next(stream for stream in probe['streams'] if stream['codec_type'] == 'audio')
    assert (video['codec_name'], video['width'], video['height'], video['r_frame_rate']) == ('h264', 1280, 720, '24/1')
    assert audio['codec_name'] == 'aac' and int(audio['sample_rate']) == 44100 and audio['channels'] == 2
    assert int(video['nb_frames']) == math.ceil(record['duration'] * 24)
    assert abs(float(probe['format']['duration']) - record['duration']) <= 1 / 24 + 0.03
    times = json.loads(bounded_tool(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                                    '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', str(path)], 1024 * 1024))
    pts = [float(frame['best_effort_timestamp_time']) for frame in times['frames']]
    assert len(pts) == int(video['nb_frames']) and all(a < b for a, b in zip(pts, pts[1:]))
    last = record['cues'][-1]
    active_index = min(range(len(pts)), key=lambda i: abs(pts[i] - (last['start'] + last['end']) / 2))
    assert last['start'] <= pts[active_index] < last['end']
    gap_start = record['cues'][-2]['end'] if len(record['cues']) > 1 else 0
    assert gap_start < last['start'], 'Fixture must contain a gap before the final cue'
    gap_index = min(range(len(pts)), key=lambda i: abs(pts[i] - (gap_start + last['start']) / 2))
    assert gap_start <= pts[gap_index] < last['start']
    wanted = sorted([active_index, gap_index])
    raw = bounded_tool(['ffmpeg', '-v', 'error', '-threads', '1', '-filter_threads', '1', '-i', str(path),
                        '-vf', fr'select=eq(n\,{wanted[0]})+eq(n\,{wanted[1]})', '-vsync', '0',
                        '-frames:v', '2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], 2 * 1280 * 720 * 3)
    assert len(raw) == 2 * 1280 * 720 * 3
    counts, decoded = {}, {}
    for number, index in enumerate(wanted):
        frame = memoryview(raw)[number * 1280 * 720 * 3:(number + 1) * 1280 * 720 * 3]
        decoded[index] = frame
        accent = 0
        for y in range(170, 470):
            for x in range(120, 1160):
                offset = (y * 1280 + x) * 3
                r, g, b = frame[offset:offset + 3]
                accent += r > 140 and g > 100 and b > 40 and r > g + 15 and g > b + 20
        counts[index] = accent
    white, gold = (247, 245, 237), (228, 183, 125)
    gap_reference = glyph_reference('Instrumental break', white)
    try:
        active_reference = glyph_reference(last['text'], gold)
    except GlyphLayoutUnsupported:
        active_reference = None
    wrong_gold = glyph_reference(negative_glyph_text(last['text']), gold)
    wrong_white = glyph_reference('Wrong unrelated words', white)
    blank = memoryview(bytes((20, 35, 47)) * (1280 * 720))
    controls = dict(gapExpectedInstrumental=glyph_facts(decoded[gap_index], gap_reference),
                    activeWrongInstrumental=glyph_facts(decoded[active_index], gap_reference),
                    activeWrongText=glyph_facts(decoded[active_index], wrong_gold),
                    gapWrongText=glyph_facts(decoded[gap_index], wrong_white),
                    blankWrongInstrumental=glyph_facts(blank, gap_reference))
    assert counts[active_index] >= 100 and controls['gapExpectedInstrumental']['passed'], controls
    if active_reference is not None:
        controls.update(activeExpectedFinalLine=glyph_facts(decoded[active_index], active_reference),
                        gapWrongFinalLine=glyph_facts(decoded[gap_index], active_reference),
                        blankWrongFinalLine=glyph_facts(blank, active_reference))
        assert controls['activeExpectedFinalLine']['passed'], controls
    assert all(not result['passed'] for name, result in controls.items() if 'Wrong' in name), controls
    late = max(0, record['duration'] - 0.75)
    values = array.array('f')
    values.frombytes(bounded_tool(['ffmpeg', '-v', 'error', '-threads', '1', '-ss', str(late),
                                  '-i', str(path), '-t', '0.5', '-vn', '-f', 'f32le', '-acodec',
                                  'pcm_f32le', '-ac', '2', '-ar', '44100', 'pipe:1'], 44100 * 8))
    if sys.byteorder != 'little':
        values.byteswap()
    assert values and all(math.isfinite(v) for v in values)
    peak = max(abs(v) for v in values)
    assert 1e-5 < peak <= 1.25
    return dict(codec='h264/aac', dimensions=[1280, 720], frames=len(pts),
                duration=float(probe['format']['duration']), finalCuePts=pts[active_index],
                precedingGapPts=pts[gap_index], activeAccentPixels=counts[active_index],
                gapAccentPixels=counts[gap_index], lateAudioPeak=peak,
                glyphOracle=dict(kind='Independent fixed instrumental-gap glyph geometry/color with yuv420p reference',
                                 exactFinalGlyphsValidated=active_reference is not None,
                                 scope='Gap always checked; active gold count checked for arbitrary layout. Optional final glyph mask covers explicit short lines only, not automatic wrapping or font shaping.',
                                 thresholds=dict(coreMaskMin=240, channelTolerance=35, minCoreCoverage=0.9,
                                                 maskDilationPixels=2, minSpatialPrecision=0.95), cases=controls),
                broadAccentDiagnostic=dict(activeCount=counts[active_index], gapCount=counts[gap_index],
                    formerGapLimit=20, formerPassed=counts[active_index] >= 100 and counts[gap_index] < 20,
                    limitation='Broad hue counting can classify codec-tinted white-letter edges as gold; it is diagnostic only.'))


def run(args):
    sys.path.insert(0, str(APP))
    from karaoke.limits import MAX_VIDEO_BYTES

    started = time.monotonic()
    root = args.work_dir or Path(tempfile.mkdtemp(prefix='karaoke-archive-smoke-'))
    root.mkdir(parents=True, exist_ok=True)
    assert not any(root.iterdir()), 'Use a new empty work directory'
    a, b = root / 'library-a', root / 'library-b'
    fixture = a / 'projects' / ('a' * 32)
    original_facts = file_facts(args.source_project) if args.source_project else None
    if args.source_project:
        record = json.loads((args.source_project / 'project.json').read_bytes())
        fixture = a / 'projects' / record['id']
        fixture.mkdir(parents=True)
        for name in ('project.json', *AUDIO_NAMES, 'processing.json', 'archive-origin.json'):
            source = args.source_project / name
            if source.exists():
                assert source.is_file() and not source.is_symlink()
                shutil.copyfile(source, fixture / name)
    else:
        make_fixture(fixture, args.duration)
    record = json.loads((fixture / 'project.json').read_bytes())
    source_facts = {name: wav_facts(fixture / name) for name in AUDIO_NAMES}
    assert all(item['frames'] / 44100 == record['duration'] for item in source_facts.values())
    assert record['cues'] and record['revision'] > 0
    b.mkdir()
    report = dict(schemaVersion=1, python=sys.version.split()[0], modelReady=False,
                  inferenceCalls=0, fixture='copied existing separated audio' if args.source_project else 'original synthetic PCM',
                  separationQualityVerified=False, duration=record['duration'], cues=len(record['cues']),
                  savedRevision=record['revision'], audio=source_facts, timingsSeconds={})
    services = []
    first = Service(a)
    services.append(first)
    try:
        start = time.monotonic()
        first.job(first.request('POST', f'/api/projects/{record["id"]}/archive', dict(revision=record['revision'])))
        archive_path = root / 'original.karaoke.zip'
        first.download(f'/api/projects/{record["id"]}/archive', archive_path, 160 * 1024**2)
        original_archive = inspect_archive(archive_path)
        assert original_archive['project'] == record
        report['timingsSeconds']['exportAndDownload'] = time.monotonic() - start
        second = Service(b)
        services.append(second)
        start = time.monotonic()
        imported = second.job(second.request('POST', '/api/archives', upload=archive_path))
        new_id = imported['projectId']
        assert new_id != record['id']
        expected = dict(record, id=new_id)
        assert second.request('GET', f'/api/projects/{new_id}') == expected
        target = b / 'projects' / new_id
        for name in AUDIO_NAMES:
            assert wav_facts(target / name) == source_facts[name]
        if (fixture / 'processing.json').exists():
            assert (target / 'processing.json').read_bytes() == (fixture / 'processing.json').read_bytes()
        provenance = second.request('GET', f'/api/projects/{new_id}/archive-info')
        assert provenance == dict(imported=True, processingSupplied=(fixture / 'processing.json').exists(),
                                 origin='imported-declared', sourceProjectId=record['id'],
                                 sourceRevision=record['revision'], archiveSha256=original_archive['sha256'])
        report['timingsSeconds']['uploadAndRestore'] = time.monotonic() - start
        first.close()
        services.remove(first)
        second.close()
        services.remove(second)
        start = time.monotonic()
        restarted = Service(b)
        services.append(restarted)
        assert restarted.pid != second.pid
        assert restarted.request('GET', f'/api/projects/{new_id}') == expected
        assert restarted.request('GET', f'/api/projects/{new_id}/archive-info') == provenance
        report['timingsSeconds']['realProcessRestart'] = time.monotonic() - start
        restarted.job(restarted.request('POST', f'/api/projects/{new_id}/archive', dict(revision=record['revision'])))
        exported_path = root / 'restored.karaoke.zip'
        restarted.download(f'/api/projects/{new_id}/archive', exported_path, 160 * 1024**2)
        reexport = inspect_archive(exported_path)
        assert reexport['project'] == expected and reexport['manifest']['origin'] == 'imported-declared'
        for name in (*AUDIO_NAMES, 'processing.json'):
            prior = next((r for r in original_archive['members'] if r['name'] == name), None)
            later = next((r for r in reexport['members'] if r['name'] == name), None)
            assert prior == later
        # Request cancellation through the real route while another backup is
        # admitted. A tiny fixture may legitimately finish before cancellation;
        # record that race honestly, and always verify prior-cache integrity.
        cancel_started = time.monotonic()
        pending = restarted.request('POST', f'/api/projects/{new_id}/archive', dict(revision=record['revision']))
        cancelled = restarted.request('POST', '/api/jobs/' + pending['job']['id'] + '/cancel')
        cancel_result = restarted.job(cancelled, statuses=('cancelled', 'complete'))
        after_cancel = root / 'after-cancel.karaoke.zip'
        restarted.download(f'/api/projects/{new_id}/archive', after_cancel, 160 * 1024**2)
        assert digest(after_cancel) == digest(exported_path)
        assert restarted.request('GET', f'/api/projects/{new_id}') == expected
        report['cancellation'] = dict(requested=True, observedStatus=cancel_result['status'],
                                      oldCacheUnchanged=True, projectUnchanged=True, scratchClean=True)
        report['timingsSeconds']['cancelAndCacheCheck'] = time.monotonic() - cancel_started
        srt = root / 'saved.srt'
        restarted.download(f'/api/projects/{new_id}/lyrics', srt, 256 * 1024)
        assert srt.read_bytes() == expected_srt(expected)
        media = None
        if not args.skip_video:
            start = time.monotonic()
            restarted.job(restarted.request('POST', f'/api/projects/{new_id}/export'), timeout=650)
            video = root / 'restored.mp4'
            restarted.download(f'/api/projects/{new_id}/video', video, MAX_VIDEO_BYTES)
            media = inspect_video(video, expected)
            report['timingsSeconds']['actualVideoExportDownloadAndDecode'] = time.monotonic() - start
        report.update(archiveBytes=original_archive['bytes'], archiveSha256=original_archive['sha256'],
                      originalId=record['id'], restoredId=new_id, realRestart=True,
                      restoredProcessPids=[second.pid, restarted.pid], provenance=provenance, video=media,
                      srtSha256=digest(srt), retainedBytes=sum(p.stat().st_size for p in root.rglob('*') if p.is_file()),
                      observedScratchPeakBytes=max(first.scratch_peak, second.scratch_peak, restarted.scratch_peak),
                      observedServicePeakRssKiB=max(first.rss_peak_kib, second.rss_peak_kib, restarted.rss_peak_kib),
                      scratchCleanupVerified=all(not any((library / '.jobs').iterdir()) for library in (a, b)),
                      limitations=['Checksums detect corruption, not authenticity or model quality.',
                                   'RSS/disk samples are observations, not continuous process-tree maxima.',
                                   'Video pixels verify late cue activation/gap; they do not OCR every lyric. Bundled font lacks Tibetan glyphs: bytes remain exact, but raster checks compare available glyphs/missing-glyph boxes, not Tibetan shaping.',
                                   'Native browser acceptance is a separate production test.'])
    finally:
        for service in reversed(services):
            service.close()
    if args.source_project:
        assert file_facts(args.source_project) == original_facts, 'Supplied original project changed'
    report['timingsSeconds']['total'] = time.monotonic() - started
    report['childPeakRssKiB'] = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    destination = args.report or root / 'verification.json'
    destination.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps(dict(report=str(destination), workDir=str(root), duration=record['duration'],
                          archiveBytes=report['archiveBytes'], realRestart=True, videoVerified=report['video'] is not None)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-project', type=Path)
    parser.add_argument('--duration', type=float, default=5)
    parser.add_argument('--work-dir', type=Path)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--skip-video', action='store_true', help='Explicit archive-only check, not complete media acceptance')
    parser.add_argument('--serve-library', type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.serve_library:
        serve_library(args.serve_library)
    else:
        assert math.isfinite(args.duration) and 1 <= args.duration <= 300
        run(args)


if __name__ == '__main__':
    main()
