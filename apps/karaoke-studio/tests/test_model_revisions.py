"""Keep exact recognizer provenance when upstream replaces a release archive."""
import dataclasses
import contextlib
import hashlib
import io
import tarfile
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from karaoke import transcription
from karaoke.transcription import ENGLISH, MULTILINGUAL, WHISPER, installed_models, model_ready, selected_models
from scripts import setup_lyrics_model


class ModelRevisionTests(unittest.TestCase):
    def variants(self):
        old = dataclasses.replace(ENGLISH, name='old-pinned-english', files={'weights': hashlib.sha256(b'old').hexdigest()})
        new = dataclasses.replace(old, name='new-pinned-english', files={'weights': hashlib.sha256(b'new').hexdigest()})
        return old, new

    def test_verification_cache_is_bound_to_expected_revision_pins(self):
        old, new = self.variants()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / old.directory).mkdir()
            (root / old.directory / 'weights').write_bytes(b'old')
            self.assertTrue(model_ready(root, old))
            self.assertFalse(model_ready(root, new), 'one verified pin set cannot verify a different revision')

    def test_discovery_returns_actual_legacy_revision_and_setup_preserves_it(self):
        old, new = self.variants()
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(transcription, 'ASR_MODELS', (new,)), \
                mock.patch.object(transcription, 'LEGACY_MODELS', (old,), create=True):
            root = Path(directory)
            (root / old.directory).mkdir()
            (root / old.directory / 'weights').write_bytes(b'old')
            self.assertEqual(installed_models(root), (old,))
            with mock.patch.object(setup_lyrics_model, 'download', side_effect=AssertionError('no download')):
                self.assertEqual(setup_lyrics_model.setup(root, new), root / old.directory)
            self.assertEqual((root / old.directory / 'weights').read_bytes(), b'old')

    def test_an_existing_pinned_archive_installs_its_actual_legacy_revision(self):
        old, new = self.variants()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            vad = root / 'vad.onnx'
            vad.write_bytes(b'vad')
            variants = []
            archives = []
            for index, (model, content) in enumerate(((old, b'old'), (new, b'new weights'))):
                archive = root / f'{index}.tar.bz2'
                prefix = model.archive.removesuffix('.tar.bz2')
                with tarfile.open(archive, 'w:bz2') as output:
                    item = tarfile.TarInfo(prefix + '/weights')
                    item.size = len(content)
                    output.addfile(item, io.BytesIO(content))
                variants.append(dataclasses.replace(model, archive_bytes=archive.stat().st_size,
                    archive_sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
                    files={'weights': hashlib.sha256(content).hexdigest(),
                           transcription.VAD_FILE: hashlib.sha256(b'vad').hexdigest()}))
                archives.append(archive)
            old, new = variants
            with mock.patch.object(transcription, 'ASR_MODELS', (new,)), \
                    mock.patch.object(transcription, 'LEGACY_MODELS', (old,)), \
                    mock.patch.object(setup_lyrics_model, 'VAD_BYTES', 3):
                destination = setup_lyrics_model.setup(root / 'models', new, archives[0], vad)
                self.assertEqual((destination / 'weights').read_bytes(), b'old')
                self.assertEqual(installed_models(root / 'models'), (old,))

    def test_whisper_uses_the_concrete_installed_multilingual_revision(self):
        prior = dataclasses.replace(MULTILINGUAL, name='prior-pinned-multilingual')
        self.assertEqual(selected_models((WHISPER, prior), 'whisper'), (WHISPER, prior))
        self.assertEqual(selected_models((prior,), 'multilingual'), (prior,))

    def test_a_verified_legacy_install_does_not_rehash_failed_current_pins_on_each_read(self):
        old, new = self.variants()
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(transcription, 'ASR_MODELS', (new,)), \
                mock.patch.object(transcription, 'LEGACY_MODELS', (old,)):
            root = Path(directory)
            (root / old.directory).mkdir()
            (root / old.directory / 'weights').write_bytes(b'old')
            original, reads = Path.open, []

            def opened(path, *args, **kwargs):
                if args and args[0] == 'rb':
                    reads.append(path)
                return original(path, *args, **kwargs)

            with mock.patch.object(Path, 'open', opened):
                self.assertEqual(installed_models(root), (old,))
                first = len(reads)
                for _ in range(3):
                    self.assertEqual(installed_models(root), (old,))
                self.assertEqual(len(reads), first, 'unchanged files keep both positive and negative pin results')
                (root / old.directory / 'weights').write_bytes(b'new')
                self.assertEqual(installed_models(root), (new,), 'metadata changes still retire cached failures')

    def test_cli_reports_the_resolved_installation_path(self):
        destination = Path('/tmp/resolved-lyric-models') / ENGLISH.directory
        def installed(root):
            return (ENGLISH,) if root == destination.parent else ()
        with mock.patch('sys.argv', ['setup', '--model-dir', '~/models', '--only', 'english']), \
                mock.patch.object(setup_lyrics_model, 'setup', return_value=destination), \
                mock.patch.object(setup_lyrics_model, 'installed_models', installed), contextlib.redirect_stdout(io.StringIO()):
            setup_lyrics_model.main()

    def test_whisper_transcript_provenance_identifies_the_actual_timing_revision(self):
        current = transcription.transcript_model_name(WHISPER, (WHISPER, MULTILINGUAL))
        previous = transcription.transcript_model_name(WHISPER, (WHISPER, transcription.LEGACY_MULTILINGUAL))
        self.assertNotEqual(current, previous)
        self.assertEqual(previous, WHISPER.name)
        self.assertIn(current, transcription.KNOWN_MODELS)


if __name__ == '__main__':
    unittest.main()
