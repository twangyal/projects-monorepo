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


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='karaoke-browser-') as directory:
        root = Path(__file__).resolve().parents[1]
        server = create_server(Path(directory), Path(directory) / 'models',
                               port=int(os.environ.get('KARAOKE_TEST_PORT', '4188')),
                               dist_dir=root / 'dist', font_path=root / 'assets' / 'DejaVuSans.ttf',
                               separate=fixture_separation, ready=lambda _: True)
        try:
            server.serve_forever(poll_interval=.05)
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
