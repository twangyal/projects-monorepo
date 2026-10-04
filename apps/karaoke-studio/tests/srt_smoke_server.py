"""Independent #105 original PCM fixtures, actual service, and artifact oracle.

Only --serve imports the production server. No parser/UI or production card
renderer supplies expected text, timing, RGB masks, project JSON, or PCM values.
Existing independently authored archive/glyph inspection helpers are reused.
"""
from __future__ import annotations
import argparse
import array
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import signal
import struct
import sys
import threading
import wave

APP = Path(__file__).resolve().parents[1]


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(65536), b''):
            value.update(block)
    return value.hexdigest()


def independent_tools():
    path = APP / 'scripts' / 'smoke_archive.py'
    spec = importlib.util.spec_from_file_location('prior_independent_archive_oracle', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def seed(root):
    expected = json.loads((root / 'frozen-expectations.json').read_text())
    facts = {}
    for project in expected['projects']:
        folder = root / 'library' / 'projects' / project['id']
        folder.mkdir(parents=True)
        (folder / 'project.json').write_text(json.dumps(project, ensure_ascii=False), encoding='utf-8')
        # Unknown processing claims remain empty; these are original synthetic
        # source/vocals/backing signals, explicitly not measured separation.
        (folder / 'processing.json').write_text('{}\n')
        facts[project['id']] = {}
        for index, name in enumerate(('source.wav', 'vocals.wav', 'backing.wav')):
            # One exact second of integer-frequency stereo waves can repeat
            # without a discontinuity. It remains full uncompressed300s PCM.
            second = bytearray()
            for n in range(44100):
                left = round(6000 * math.sin(2 * math.pi * (220 + index * 110) * n / 44100))
                right = round(4000 * math.sin(2 * math.pi * (330 + index * 110) * n / 44100))
                second += struct.pack('<hh', left, right)
            path = folder / name
            with wave.open(str(path), 'wb') as output:
                output.setnchannels(2)
                output.setsampwidth(2)
                output.setframerate(44100)
                for _ in range(project['duration']):
                    output.writeframesraw(second)
            facts[project['id']][name] = dict(bytes=path.stat().st_size, sha256=digest(path),
                                             frames=project['duration'] * 44100,
                                             leftHz=220 + index * 110, rightHz=330 + index * 110)
    (root / 'audio-facts.json').write_text(json.dumps(facts, indent=2) + '\n')
    print(json.dumps({'seededProjects': len(expected['projects']), 'modelUsed': False}))


def serve(directory, port):
    sys.path.insert(0, str(APP))
    from karaoke.server import create_server

    def forbidden(*_):
        (directory / 'INFERENCE-WAS-CALLED').write_text('Unexpected inference call')
        raise AssertionError('Original SRT smoke never invokes inference.')

    server = create_server(directory, directory / 'no-model', port=port,
                           dist_dir=APP / 'dist', font_path=APP / 'assets' / 'DejaVuSans.ttf',
                           separate=forbidden, ready=lambda _: False)
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    print(server.server_address[1], flush=True)
    try:
        server.serve_forever(poll_interval=.05)
    finally:
        server.server_close()


def inspect_video(path, expectations):
    oracle = independent_tools()
    target = json.loads(expectations.read_text())['video']
    run = oracle.bounded_tool
    metadata = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(path)], 1024 * 1024))
    video = next(s for s in metadata['streams'] if s['codec_type'] == 'video')
    audio = next(s for s in metadata['streams'] if s['codec_type'] == 'audio')
    assert video['codec_name'] == 'h264' and audio['codec_name'] == 'aac'
    assert (video['width'], video['height'], video['r_frame_rate'], int(video['nb_frames'])) == (1280, 720, '24/1', 144)
    assert abs(float(video['duration']) - 6) <= 1 / 24
    pts = json.loads(run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', str(path)], 1024 * 1024))['frames']
    assert len(pts) == 144
    for index, frame in enumerate(pts):
        assert abs(float(frame['best_effort_timestamp_time']) - index / 24) < .00001
    samples = target['samples']
    select = 'select=' + '+'.join(f'eq(n\\,{item["frame"]})' for item in samples)
    raw = run(['ffmpeg', '-v', 'error', '-threads', '1', '-filter_threads', '1', '-i', str(path), '-vf', select, '-vsync', '0', '-frames:v', str(len(samples)), '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], len(samples) * 1280 * 720 * 3)
    assert len(raw) == len(samples) * 1280 * 720 * 3
    references = {}
    results = []
    for position, item in enumerate(samples):
        color = (228, 183, 125) if item['active'] else (247, 245, 237)
        key = (item['text'], color)
        if key not in references:
            references[key] = oracle.glyph_reference(*key)
        frame = memoryview(raw)[position * 1280 * 720 * 3:(position + 1) * 1280 * 720 * 3]
        actual = oracle.glyph_facts(frame, references[key])
        assert actual['passed'], f'Original expected glyphs failed at frame {item["frame"]}.'
        # The same decoded output must refuse a genuinely different lyric, not
        # merely pass a broad gold-versus-white pixel count.
        wrong_text = 'Cobalt closing line' if item['text'] != 'Cobalt closing line' else 'Silver opening line'
        wrong_key = (wrong_text, color)
        if wrong_key not in references:
            references[wrong_key] = oracle.glyph_reference(*wrong_key)
        wrong = oracle.glyph_facts(frame, references[wrong_key])
        assert not wrong['passed'], f'Wrong supplied line falsely matched frame {item["frame"]}.'
        blank = oracle.glyph_facts(memoryview(bytes([20, 35, 47]) * (1280 * 720)), references[key])
        assert not blank['passed']
        results.append(dict(frame=item['frame'], text=item['text'], active=item['active'], expected=actual,
                            wrongLineRejected=True, blankRejected=True))
    pcm = array.array('h')
    pcm.frombytes(run(['ffmpeg', '-v', 'error', '-threads', '1', '-ss', '5', '-i', str(path), '-t', '.5', '-vn', '-ac', '1', '-ar', '44100', '-f', 's16le', 'pipe:1'], 44100))
    assert len(pcm) > 10000 and max(abs(value) for value in pcm) > 500
    return dict(status='passed', frames=144, duration=6, codecs=['h264', 'aac'], samples=results,
                lateAudioNonSilent=True, glyphThresholds=target['glyphThresholds'], bytes=path.stat().st_size,
                sha256=digest(path), fontSha256=digest(APP / 'assets' / 'DejaVuSans.ttf'))


def inspect_archive(path, expectations, audio_facts):
    result = independent_tools().inspect_archive(path)
    expected = json.loads(expectations.read_text())['expected'][0]
    assert result['project'] == expected
    audio = json.loads(audio_facts.read_text())[expected['id']]
    for name, facts in audio.items():
        member = next(item for item in result['members'] if item['name'] == name)
        assert member['bytes'] == facts['bytes'] and member['sha256'] == facts['sha256']
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--seed', type=Path)
    mode.add_argument('--serve', type=Path)
    mode.add_argument('--inspect-video', type=Path)
    mode.add_argument('--inspect-archive', type=Path)
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--expectations', type=Path)
    parser.add_argument('--audio-facts', type=Path)
    args = parser.parse_args()
    if args.seed:
        seed(args.seed)
    elif args.serve:
        serve(args.serve, args.port)
    elif args.inspect_video:
        print(json.dumps(inspect_video(args.inspect_video, args.expectations)))
    else:
        print(json.dumps(inspect_archive(args.inspect_archive, args.expectations, args.audio_facts)))


if __name__ == '__main__':
    main()
