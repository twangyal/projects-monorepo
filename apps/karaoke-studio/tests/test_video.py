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

    def _mean_volume(self, path):
        report = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(path), '-map', '0:a:0', '-af', 'volumedetect',
                                 '-f', 'null', '-'], capture_output=True, text=True, check=True).stderr
        return float(report.split('mean_volume: ')[1].split(' dB')[0])

    def test_guide_vocal_mixes_the_separated_vocals_under_the_backing(self):
        vocals = self.root / 'vocals.wav'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=44100',
                        '-ac', '2', '-c:a', 'pcm_s16le', str(vocals)], check=True)
        plain, guided = self.root / 'plain.mp4', self.root / 'guided.mp4'
        video.export_video(self.project, self.backing, plain, self.root / 'work', FONT, threading.Event())
        video.export_video(self.project, self.backing, guided, self.root / 'work', FONT, threading.Event(),
                           vocals=vocals, guide=0.3)
        # The backing is silent: only the guide vocal can be heard in the mixed video.
        self.assertLess(self._mean_volume(plain), -80)
        self.assertGreater(self._mean_volume(guided), -40)

    def test_guide_vocal_level_and_source_are_validated(self):
        for guide, vocals in [(0.6, self.backing), (-0.1, self.backing), (0.2, None)]:
            with self.assertRaises(ValidationError):
                video.export_video(self.project, self.backing, self.root / 'x.mp4', self.root / 'work', FONT,
                                   threading.Event(), vocals=vocals, guide=guide)

    def test_word_highlighting_colours_only_the_sung_words(self):
        project = update_project(self.project, 'Words', [dict(start=0, end=3, text='LEFT RIGHT')], 1)
        cards = {}
        for name, sung in [('none', []), ('one', ['LEFT']), ('all', ['LEFT', 'RIGHT']), ('legacy', None)]:
            output = self.root / f'{name}.png'
            video.render_card(project, 0, output, FONT, sung=sung)
            cards[name] = Image.open(output).convert('RGB')
            self.addCleanup(cards[name].close)
        accent = (0xe4, 0xb7, 0x7d)

        def accent_columns(image):
            pixels = image.load()
            return [x for x in range(1280) if any(pixels[x, y] == accent for y in range(290, 350))]
        self.assertEqual(accent_columns(cards['none']), [])
        left, everything = accent_columns(cards['one']), accent_columns(cards['all'])
        self.assertTrue(left and everything and max(left) < 640 < max(everything))
        # The whole sung line looks exactly like the previous whole-line highlight.
        self.assertEqual(ImageChops.difference(cards['all'], cards['legacy']).getbbox(), None)
        # Unsung text keeps the same position: only colours change.
        background = Image.new('RGB', (1280, 720), (20, 35, 47))

        def mask(image):
            return ImageChops.difference(image, background).convert('L').point(lambda value: 255 if value else 0)
        self.assertEqual(ImageChops.difference(mask(cards['none']), mask(cards['all'])).getbbox(), None)

    def test_count_in_follows_breaks_of_four_seconds_or_more(self):
        cues = [dict(start=10, end=12, text='a'), dict(start=13, end=14, text='b'), dict(start=20, end=22, text='c')]
        self.assertEqual([video.count_in(cues, t) for t in (6.5, 7, 8.5, 9.99, 10, 12.5, 15, 17.01, 19.99, 23)],
                         [None, 3, 2, 1, None, None, None, 3, 1, None])

    def test_count_in_dots_are_drawn_during_a_break(self):
        # The colour of words not yet sung: the highlight colour stays for words being sung.
        unsung = (0xf7, 0xf5, 0xed)

        def dots(count):
            output = self.root / f'count{count}.png'
            video.render_card(self.project, None, output, FONT, count=count)
            with Image.open(output) as image:
                pixels = image.convert('RGB').load()
                columns = [x for x in range(1280) if pixels[x, 430] == unsung]
            # Runs of accent columns are the dots.
            return sum(1 for index, x in enumerate(columns) if not index or x != columns[index - 1] + 1)
        self.assertEqual([dots(count) for count in (None, 1, 2, 3)], [0, 1, 2, 3])

    def test_exported_breaks_count_singers_in(self):
        backing = self.root / 'long.wav'
        with wave.open(str(backing), 'wb') as stream:
            stream.setnchannels(2)
            stream.setsampwidth(2)
            stream.setframerate(44100)
            stream.writeframes(b'\0' * 44100 * 7 * 4)
        project = update_project(create_project('b' * 32, 'Break', 7), 'Break', [dict(start=5, end=6.5, text='LATE LINE')], 0)
        output = self.root / 'break.mp4'
        video.export_video(project, backing, output, self.root / 'work', FONT, threading.Event())
        unsung = (0xf7, 0xf5, 0xed)
        for seconds, expected in [(1.5, 0), (2.2, 3), (3.5, 2), (4.6, 1)]:
            with self.subTest(seconds=seconds):
                decoded = self.root / f'break{seconds}.png'
                subprocess.run(['ffmpeg', '-v', 'error', '-i', str(output), '-vf', f'select=eq(n\\,{round(seconds * 24)})',
                                '-frames:v', '1', '-y', str(decoded)], check=True)
                with Image.open(decoded) as image:
                    pixels = image.convert('RGB').load()
                    # Video compression shifts colours slightly: a dot is a run of near-accent pixels.
                    near = [x for x in range(1280) if sum(abs(a - b) for a, b in zip(pixels[x, 430], unsung)) < 60]
                runs = sum(1 for index, x in enumerate(near) if not index or x != near[index - 1] + 1)
                self.assertEqual(runs, expected)

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
        # Without recognized words, FIRST starts with its line (0.5 s) and LINE at 0.827 s; SECOND LINE
        # starts at 1.75 s with LINE at 2.1 s.
        states = [({**self.project, 'cues': self.project['cues']}, None, None),
                  (self.project, 0, ['FIRST']), (self.project, 0, ['FIRST', 'LINE']),
                  ({**self.project, 'cues': self.project['cues'][1:]}, None, None),
                  (self.project, 1, ['SECOND']), (self.project, 1, ['SECOND', 'LINE']),
                  ({**self.project, 'cues': []}, None, None)]
        references = []
        for index, (project, active, sung) in enumerate(states):
            card = self.root / f'reference{index}.png'
            video.render_card(project, active, card, FONT, sung=sung)
            with Image.open(card) as image:
                references.append(image.convert('RGB').crop((100, 160, 1180, 620)))
        for frame, expected in [(11, 0), (12, 1), (19, 1), (20, 2), (29, 2), (30, 3), (41, 3), (42, 4),
                                (50, 4), (51, 5), (59, 5), (60, 6)]:
            with self.subTest(frame=frame):
                decoded = self.root / f'frame{frame}.png'
                subprocess.run(['ffmpeg', '-v', 'error', '-i', str(output), '-vf',
                                f'select=eq(n\\,{frame})', '-frames:v', '1', '-y', str(decoded)], check=True)
                with Image.open(decoded) as image:
                    crop = image.convert('RGB').crop((100, 160, 1180, 620))
                    errors = [sum(ImageStat.Stat(ImageChops.difference(crop, ref)).mean) for ref in references]
                self.assertEqual(errors.index(min(errors)), expected)
                self.assertLess(errors[expected], min(error for index, error in enumerate(errors) if index != expected))
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

    def test_backing_validation_reads_bounded_blocks(self):
        actual_read = wave.Wave_read.readframes
        requests = []

        def bounded_read(stream, count):
            requests.append(count)
            self.assertLessEqual(count, 65536)
            return actual_read(stream, count)

        def encoded(_arguments, _cancel, output, **_kwargs):
            output.write_bytes(b'encoded fixture')

        with patch.object(wave.Wave_read, 'readframes', bounded_read), \
                patch.object(video, '_run_ffmpeg', side_effect=encoded):
            video.export_video(self.project, self.backing, self.root / 'video.mp4',
                               self.root / 'work', FONT, threading.Event())
        self.assertGreater(len(requests), 1)

    def test_backing_validation_observes_cancel_and_deadline_between_blocks(self):
        actual_read = wave.Wave_read.readframes
        for reason in ('cancel', 'time limit'):
            with self.subTest(reason=reason):
                cancel = threading.Event()
                clock = [10.0]
                reads = []
                output = self.root / 'video.mp4'
                output.write_bytes(b'previous export')

                def interrupt_read(stream, count):
                    reads.append(count)
                    result = actual_read(stream, count)
                    if reason == 'cancel':
                        cancel.set()
                    else:
                        clock[0] += 601
                    return result

                with patch.object(wave.Wave_read, 'readframes', interrupt_read), \
                        patch.object(video.time, 'monotonic', side_effect=lambda: clock[0]), \
                        patch.object(video, 'render_card') as renderer:
                    with self.assertRaisesRegex(RuntimeError, reason):
                        video.export_video(self.project, self.backing, output,
                                           self.root / 'work', FONT, cancel)
                self.assertEqual(len(reads), 1)
                renderer.assert_not_called()
                self.assertEqual(output.read_bytes(), b'previous export')
                self.assertEqual(list(self.root.glob('.video-*.mp4')), [])

    def test_deadline_after_encoding_still_preserves_previous_export(self):
        output = self.root / 'video.mp4'
        output.write_bytes(b'previous export')
        clock = [10.0]

        def late_encode(_arguments, _cancel, path, **_kwargs):
            path.write_bytes(b'late encoded video')
            clock[0] += 601

        with patch.object(video.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(video, '_run_ffmpeg', side_effect=late_encode):
            with self.assertRaisesRegex(RuntimeError, 'time limit'):
                video.export_video(self.project, self.backing, output,
                                   self.root / 'work', FONT, threading.Event())
        self.assertEqual(output.read_bytes(), b'previous export')
        self.assertEqual(list((self.root / 'work').iterdir()), [])
        self.assertEqual(list(self.root.glob('.video-*.mp4')), [])

    def test_preparation_deadline_preserves_previous_export(self):
        output = self.root / 'video.mp4'
        output.write_bytes(b'previous export')
        clock = [10.0]

        def slow_card(_project, _active, path, _font, **_options):
            path.write_bytes(b'card')
            clock[0] += 601

        with patch.object(video.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(video, 'render_card', side_effect=slow_card), \
                patch.object(video, '_run_ffmpeg') as encoder:
            with self.assertRaisesRegex(RuntimeError, 'time limit'):
                video.export_video(self.project, self.backing, output,
                                   self.root / 'work', FONT, threading.Event())
        encoder.assert_not_called()
        self.assertEqual(output.read_bytes(), b'previous export')
        self.assertEqual(list((self.root / 'work').iterdir()), [])
        self.assertEqual(list(self.root.glob('.video-*.mp4')), [])

    def test_distinct_card_budget_preserves_previous_export(self):
        output = self.root / 'video.mp4'
        output.write_bytes(b'previous export')

        def large_card(_project, _active, path, _font, **_options):
            path.write_bytes(b'x' * 17)

        with patch.object(video, 'MAX_CARD_BYTES', 16, create=True), \
                patch.object(video, 'render_card', side_effect=large_card), \
                patch.object(video, '_run_ffmpeg') as encoder:
            with self.assertRaisesRegex(RuntimeError, 'card.*limit'):
                video.export_video(self.project, self.backing, output,
                                   self.root / 'work', FONT, threading.Event())
        encoder.assert_not_called()
        self.assertEqual(output.read_bytes(), b'previous export')
        self.assertEqual(list((self.root / 'work').iterdir()), [])

    def test_full_song_prepares_exact_frame_links_and_shares_remaining_deadline(self):
        with wave.open(str(self.backing), 'wb') as stream:
            stream.setnchannels(2)
            stream.setsampwidth(2)
            stream.setframerate(44100)
            for _second in range(300):
                stream.writeframesraw(b'\0' * 44100 * 4)
        project = update_project(create_project('a' * 32, 'Full song', 300), 'Full song',
                                 [dict(start=0.25 + index * 1.5, end=0.75 + index * 1.5,
                                       text=f'Line {index}') for index in range(200)], 0)
        clock = [10.0]
        card_count = [0]
        sung_states = []

        def card(_project, active, path, _font, sung=None, count=None):
            path.write_text(str(card_count[0]))
            sung_states.append((active, sung))
            card_count[0] += 1
            clock[0] += 0.1

        def encoded(arguments, _cancel, output, **kwargs):
            directory = Path(arguments[arguments.index('-i') + 1]).parent
            frames = sorted(directory.glob('frame*.png'))
            self.assertEqual(len(frames), 7200)
            # Each two-word line has one card per sung word; each gap one card.
            self.assertEqual(len(list(directory.glob('card*.png'))), 601)
            self.assertEqual(len({frame.stat().st_ino for frame in frames}), 601)
            for frame, state in [(0, 0), (6, 1), (12, 1), (13, 2), (17, 2), (18, 3), (7170, 598), (7199, 600)]:
                self.assertEqual(frames[frame].read_text(), str(state))
            self.assertAlmostEqual(kwargs['timeout'], 539.9, places=6)
            self.assertEqual(kwargs['max_output_bytes'], 128 * 1024 * 1024)
            output.write_bytes(b'encoded fixture')

        with patch.object(video.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(video, 'render_card', side_effect=card), \
                patch.object(video, '_run_ffmpeg', side_effect=encoded):
            video.export_video(project, self.backing, self.root / 'video.mp4',
                               self.root / 'work', FONT, threading.Event())
        self.assertEqual(card_count[0], 601)
        self.assertEqual(sung_states[1:3], [(0, ['Line']), (0, ['Line', '0'])])
        self.assertEqual(list((self.root / 'work').iterdir()), [])

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


class ScriptFallbackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = update_project(create_project('b' * 32, 'Scripts', 3), 'Scripts',
                                      [dict(start=0, end=3, text='café olé')], 0)
        self.clear()
        self.addCleanup(self.clear)

    @staticmethod
    def clear():
        for cached in (video._fonts, video._coverage, video._system_fonts, video._loadable):
            cached.cache_clear()

    def card(self, name, project, **options):
        output = self.root / f'{name}.png'
        video.render_card(project, 0, output, FONT, **options)
        with Image.open(output) as image:
            return image.convert('RGB')

    def test_characters_missing_from_the_bundled_font_use_an_installed_font(self):
        # The bundled font is made to lack accented letters; an installed font (here a copy of it) covers them.
        fallback = self.root / 'Fallback.ttf'
        shutil.copyfile(FONT, fallback)

        def coverage(path, _index):
            return ((0x20, 0x7e),) if path == str(FONT) else ((0x20, 0x10ffff),)
        with patch.object(video, '_coverage', side_effect=coverage), \
                patch.object(video, '_system_font', return_value=(str(fallback), 0)) as lookup:
            fonts = video._fonts(str(FONT))
            self.assertEqual(fonts.runs('café olé'), [(0, 'caf'), (1, 'é '), (0, 'ol'), (1, 'é')])
            self.assertEqual(fonts.faces, [(str(FONT), 0), (str(fallback), 0)])
            # Combining marks stay with the letter before them.
            self.assertEqual(fonts.runs('café'), [(0, 'café')])
            self.assertEqual(lookup.call_count, 1, 'fontconfig is asked once for a script')
            sung = self.card('sung', self.project, sung=['café'])
            whole = self.card('whole', self.project, sung=['café', 'olé'])
            legacy = self.card('legacy', self.project)
        def columns(colour):
            return [x for x in range(1280) if any(sung.getpixel((x, y)) == colour for y in range(290, 350))]
        highlighted, unsung = columns((0xe4, 0xb7, 0x7d)), columns((0xf7, 0xf5, 0xed))
        self.assertTrue(highlighted and unsung and max(highlighted) < min(unsung), 'only the first word is highlighted')
        self.assertEqual(ImageChops.difference(whole, legacy).getbbox(), None)

    def test_fonts_that_cannot_be_drawn_at_any_size_are_passed_over(self):
        # Colour emoji fonts hold fixed-size bitmaps; Pillow refuses them at lyric sizes.
        bitmap = self.root / 'ColorEmoji.ttf'
        bitmap.write_bytes(b'not a scalable font')
        with patch.object(video, '_system_fonts', return_value=((str(bitmap), 0), (str(FONT), 0))):
            self.assertEqual(video._system_font(0x1f3b5), (str(FONT), 0))
        with patch.object(video, '_system_fonts', return_value=((str(bitmap), 0),)):
            self.assertIsNone(video._system_font(0x1f3b5))

    def test_without_fontconfig_every_character_uses_the_bundled_font(self):
        with patch.object(video.subprocess, 'run', side_effect=FileNotFoundError('fc-query')):
            fonts = video._fonts(str(FONT))
            self.assertEqual(fonts.runs('日本 café'), [(0, '日本 café')])
            self.card('plain', update_project(self.project, 'Scripts', [dict(start=0, end=3, text='日本 café')], 1))

    @unittest.skipUnless(shutil.which('fc-list'), 'fontconfig is not installed')
    def test_installed_fonts_replace_missing_glyph_boxes(self):
        lyrics = {'Japanese': '日本語の歌', 'Tibetan': 'བོད་ཀྱི་གླུ', 'Hindi': 'मेरा गाना'}
        for language, text in lyrics.items():
            with self.subTest(language=language):
                if video._system_font(ord(text[0])) is None:
                    self.skipTest(f'no installed font covers {language}')
                project = update_project(self.project, 'Scripts', [dict(start=0, end=3, text=text)], 1)
                self.clear()
                found = self.card(f'{language}-font', project)
                self.assertNotEqual(video._fonts(str(FONT)).runs(text)[0][0], 0)
                self.clear()
                with patch.object(video, '_system_font', return_value=None):
                    boxes = self.card(f'{language}-boxes', project)
                self.assertIsNotNone(ImageChops.difference(found, boxes).getbbox())
