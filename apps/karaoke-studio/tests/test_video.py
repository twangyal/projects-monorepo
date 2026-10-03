import json
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import threading
import unittest
import wave
from unittest.mock import patch

from PIL import Image, ImageChops, ImageStat
from karaoke.model import create_project, update_project, ValidationError
from karaoke import video
from karaoke.media_io import inherit_media_handles

FONT = Path(__file__).resolve().parents[1] / 'assets' / 'DejaVuSans.ttf'


class VideoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.backing = self.root / 'backing.wav'
        with wave.open(str(self.backing), 'wb') as stream:
            stream.setnchannels(2)
            stream.setsampwidth(2)
            stream.setframerate(44100)
            stream.writeframes(b'\0' * 44100 * 3 * 4)
        self.project = update_project(create_project('a' * 32, 'Example clip', 3), 'Example clip',
                                     [dict(start=0.5, end=1.25, text='FIRST LINE'),
                                      dict(start=1.75, end=2.5, text='SECOND LINE')], 0)

    def test_literal_lyrics_render_without_interpreting_markup_or_commands(self):
        project = update_project(self.project, 'Literal text', [dict(start=0, end=3,
                                 text='<script>alert(1)</script> $(touch nope) % {x}: \\\"')], 1)
        output = self.root / 'card.png'
        video.render_card(project, 0, output, FONT)
        with Image.open(output) as image:
            self.assertEqual(image.size, (1280, 720))
            self.assertEqual(image.getpixel((0, 0)), (20, 35, 47))
            self.assertGreater(sum(ImageStat.Stat(image.crop((100, 220, 1180, 430))).var), 100)
        self.assertFalse((self.root / 'nope').exists())

    def test_real_video_export_preserves_owned_handle_paths_through_ffmpeg(self):
        original = self.root / 'media'
        original.mkdir()
        shutil.copyfile(self.backing, original / 'backing.wav')
        fd = os.open(original, os.O_RDONLY | os.O_DIRECTORY)
        try:
            retained = self.root / 'retained-media'
            original.rename(retained)
            original.mkdir()
            owned = Path(f'/proc/self/fd/{fd}')
            with inherit_media_handles(fd):
                video.export_video(self.project, owned / 'backing.wav', owned / 'video.mp4',
                                   owned / 'work', FONT, threading.Event())
            metadata = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams',
                                  '-of', 'json', str(retained / 'video.mp4')]))
            self.assertEqual({item['codec_type'] for item in metadata['streams']}, {'audio', 'video'})
            self.assertEqual(list(original.iterdir()), [])
        finally:
            os.close(fd)

    def test_long_lyric_preview_stays_inside_its_layout_region(self):
        project = update_project(self.project, 'Long lyrics',
                                 [dict(start=0, end=1, text='W' * 240),
                                  dict(start=1, end=3, text='W' * 240)], 1)
        output = self.root / 'long.png'
        video.render_card(project, 0, output, FONT)
        with Image.open(output) as image:
            for band in [(100, 130, 1180, 165), (100, 480, 1180, 499), (100, 581, 1180, 630)]:
                self.assertEqual(ImageStat.Stat(image.crop(band)).var, [0.0, 0.0, 0.0])

    def test_export_has_expected_streams_duration_and_cards_at_boundaries(self):
        output = self.root / 'video.mp4'
        video.export_video(self.project, self.backing, output, self.root / 'work', FONT, threading.Event())
        metadata = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams',
                                '-show_format', '-of', 'json', str(output)]))
        streams = {item['codec_type']: item for item in metadata['streams']}
        self.assertEqual(streams['video']['codec_name'], 'h264')
        self.assertEqual(streams['video']['r_frame_rate'], '24/1')
        self.assertEqual((streams['video']['width'], streams['video']['height']), (1280, 720))
        self.assertEqual(streams['audio']['codec_name'], 'aac')
        self.assertLessEqual(abs(float(metadata['format']['duration']) - 3), 1 / 24)
        states = [({**self.project, 'cues': self.project['cues']}, None),
                  (self.project, 0),
                  ({**self.project, 'cues': self.project['cues'][1:]}, None),
                  (self.project, 1), ({**self.project, 'cues': []}, None)]
        references = []
        for index, (project, active) in enumerate(states):
            card = self.root / f'reference{index}.png'
            video.render_card(project, active, card, FONT)
            with Image.open(card) as image:
                references.append(image.convert('RGB').crop((100, 160, 1180, 620)))
        for frame, expected in [(11, 0), (12, 1), (29, 1), (30, 2), (41, 2), (42, 3), (59, 3), (60, 4)]:
            with self.subTest(frame=frame):
                decoded = self.root / f'frame{frame}.png'
                subprocess.run(['ffmpeg', '-v', 'error', '-i', str(output), '-vf',
                                f'select=eq(n\\,{frame})', '-frames:v', '1', '-y', str(decoded)], check=True)
                with Image.open(decoded) as image:
                    crop = image.convert('RGB').crop((100, 160, 1180, 620))
                    errors = [sum(ImageStat.Stat(ImageChops.difference(crop, ref)).mean) for ref in references]
                self.assertEqual(errors.index(min(errors)), expected)
                self.assertLess(errors[expected], 8)
        self.assertEqual(list((self.root / 'work').iterdir()), [])

    def test_cancellation_and_validation_preserve_existing_export(self):
        output = self.root / 'video.mp4'
        output.write_bytes(b'previous successful export')
        cancel = threading.Event()
        cancel.set()
        with self.assertRaisesRegex(RuntimeError, '[Cc]ancel'):
            video.export_video(self.project, self.backing, output, self.root / 'work', FONT, cancel)
        self.assertEqual(output.read_bytes(), b'previous successful export')
        with wave.open(str(self.backing), 'wb') as stream:
            stream.setnchannels(1)
            stream.setsampwidth(2)
            stream.setframerate(44100)
            stream.writeframes(b'\0' * 44100 * 3 * 2)
        with self.assertRaises(ValidationError):
            video.export_video(self.project, self.backing, output, self.root / 'work', FONT, threading.Event())
        self.assertEqual(output.read_bytes(), b'previous successful export')

    def test_encoding_failure_preserves_previous_export_and_cleans_temporary_files(self):
        output = self.root / 'video.mp4'
        output.write_bytes(b'previous successful export')
        actual_run = video._run_ffmpeg

        def fail_codec(arguments, *args, **kwargs):
            arguments = list(arguments)
            arguments[arguments.index('libx264')] = 'not_a_real_video_codec'
            return actual_run(arguments, *args, **kwargs)

        with patch.object(video, '_run_ffmpeg', side_effect=fail_codec):
            with self.assertRaisesRegex(RuntimeError, 'could not encode'):
                video.export_video(self.project, self.backing, output, self.root / 'work', FONT, threading.Event())
        self.assertEqual(output.read_bytes(), b'previous successful export')
        self.assertEqual(list((self.root / 'work').iterdir()), [])
        self.assertEqual(list(self.root.glob('.video-*.mp4')), [])

    def test_ffmpeg_cancel_timeout_and_output_limits_kill_and_reap(self):
        command = ['ffmpeg', '-v', 'error', '-re', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-f', 'null', '-']
        processes = []
        original = subprocess.Popen

        def capture(*args, **kwargs):
            process = original(*args, **kwargs)
            processes.append(process)
            return process

        with patch.object(video.subprocess, 'Popen', side_effect=capture):
            cancel = threading.Event()
            timer = threading.Timer(0.2, cancel.set)
            timer.start()
            try:
                with self.assertRaisesRegex(RuntimeError, '[Cc]ancel'):
                    video._run_ffmpeg(command, cancel, self.root / 'unused', timeout=5)
            finally:
                timer.cancel()
                timer.join()
            with self.assertRaisesRegex(RuntimeError, 'time'):
                video._run_ffmpeg(command, threading.Event(), self.root / 'unused', timeout=0.1)
            output = self.root / 'large.wav'
            with self.assertRaisesRegex(RuntimeError, 'limit'):
                video._run_ffmpeg(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                                   'anullsrc=r=44100:cl=stereo', '-y', str(output)],
                                  threading.Event(), output, max_output_bytes=4096)
            with self.assertRaisesRegex(RuntimeError, 'diagnostic output limit'):
                video._run_ffmpeg(['ffmpeg', '-not_a_real_ffmpeg_option'], threading.Event(),
                                  self.root / 'unused', max_log_bytes=1)
        self.assertTrue(processes)
        self.assertTrue(all(process.poll() is not None for process in processes))


if __name__ == '__main__':
    unittest.main()
