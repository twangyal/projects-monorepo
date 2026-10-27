"""Fast UI-test server. Never used by the production CLI or real-model smoke."""
import os
from pathlib import Path
import shutil
import sys
import tempfile
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from karaoke.server import create_server  # noqa: E402
from karaoke.limits import MIN_DURATION, MAX_DURATION  # noqa: E402
import karaoke.server as server_module  # noqa: E402


def fixture_separation(source, output_dir, model_dir, cancel, stage):
    stage('Separating fixture audio for browser verification')
    for _ in range(10):
        if cancel.wait(.03):
            raise RuntimeError('Cancelled fixture job.')
    with wave.open(str(source), 'rb') as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (2, 2, 44100):
            raise ValueError('Choose a stereo PCM16 WAV fixture.')
        duration = audio.getnframes() / 44100
        if not MIN_DURATION <= duration <= MAX_DURATION:
            raise ValueError(f'Choose fixture audio between {MIN_DURATION} and {MAX_DURATION} seconds.')
    output_dir.mkdir(parents=True, exist_ok=True)
    for name in ('source.wav', 'vocals.wav', 'backing.wav'):
        shutil.copyfile(source, output_dir / name)
    return duration


LYRICS_FIXTURE_SECONDS = 16.0
FIXTURE_WORDS = [(text, start, start + 0.4) for text, start in (
    ('Hello', 1.0), ('little', 1.5), ('world', 2.0), ('This', 4.0), ('is', 4.4), ('our', 4.8), ('chorus', 5.2),
    ('Sing', 9.0), ('it', 9.5), ('back', 10.0), ('to', 10.5), ('me', 11.0))]


def fixture_transcription(vocals, output, model_root, duration, cancel, stage, *, model_choice='auto'):
    """Deterministic recognized words for the 16-second lyrics fixture; other clips behave like a
    recognition failure (no transcript), so existing flows keep starting without lyrics."""
    import json
    from karaoke.transcription import ENGLISH, MULTILINGUAL
    if abs(duration - 18.0) < 1e-6 and Path(output).parent.name == 'completed':
        Path(output).write_text('{"partial": true}')
        stage('Waiting for recognition cancellation in browser fixture')
        if not cancel.wait(20):
            raise RuntimeError('Recognition cancellation fixture timed out.')
        raise RuntimeError('Cancelled fixture recognition.')
    if abs(duration - 19.0) < 1e-6 and Path(output).parent.name == 'completed':
        stage('Waiting for failed recognition in browser fixture')
        cancel.wait(1.5)
        raise RuntimeError('Private recognizer detail /private/model/path must not reach the browser.')
    stage('Recognizing fixture lyrics for browser verification')
    for _ in range(10):
        if cancel.wait(.03):
            raise RuntimeError('Cancelled fixture job.')
    if min(abs(duration - LYRICS_FIXTURE_SECONDS), abs(duration - 18.0), abs(duration - 19.0)) > 1e-6:
        raise RuntimeError('No fixture lyrics for this clip.')
    transcript = dict(model=(MULTILINGUAL if model_choice == 'multilingual' else ENGLISH).name, words=[dict(text=t, start=s, end=e, confidence=0.4 if s > 9 else 0.95) for t, s, e in FIXTURE_WORDS], seconds=0.3)
    Path(output).write_text(json.dumps(transcript))
    return transcript


def forbidden_archive_separation(*_args):
    """Archive-only verification must never invoke inference, even a fixture."""
    raise AssertionError('Archive browser mode must not call a separator.')


def delayed_archive(function):
    """Control startup scheduling only; all archive bytes use the real engine."""
    def run(*args):
        cancel, stage = args[-2:]
        stage('Waiting at the browser fixture scheduling gate')
        if cancel.wait(1):
            raise RuntimeError('Cancelled archive browser fixture.')
        return function(*args)
    return run


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='karaoke-browser-') as directory:
        root = Path(__file__).resolve().parents[1]
        archive_only = os.environ.get('KARAOKE_ARCHIVE_NO_MODEL') == '1'
        # Unlike the injected audio separator, these wrappers never fabricate
        # outputs. They leave a bounded native cancellation window before work.
        server_module.import_archive = delayed_archive(server_module.import_archive)
        server_module.export_archive = delayed_archive(server_module.export_archive)
        server = create_server(Path(directory), Path(directory) / 'models',
                               port=int(os.environ.get('KARAOKE_TEST_PORT', '4188')),
                               dist_dir=root / 'dist', font_path=root / 'assets' / 'DejaVuSans.ttf',
                               separate=forbidden_archive_separation if archive_only else fixture_separation,
                               ready=lambda _: not archive_only,
                               transcribe=fixture_transcription, transcriber_ready=lambda _: not archive_only)
        try:
            server.serve_forever(poll_interval=.05)
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
