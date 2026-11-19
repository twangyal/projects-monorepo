import tempfile
import threading
import unittest
import zipfile
from pathlib import Path

from karaoke.model import create_project, update_project
from karaoke.ultrastar import BPM, artist_and_title, export_ultrastar, render_ultrastar, song_name


def notes_of(text: str) -> list[str]:
    return [line for line in text.splitlines() if line[:1] in (':', 'F', '-', 'E')]


class UltraStarTests(unittest.TestCase):
    def setUp(self):
        self.project = update_project(create_project('e' * 32, 'Nina - Blue Skies', 20.0), 'Nina - Blue Skies',
                                      [dict(start=1.0, end=3.0, text='Hello little world'), dict(start=4.0, end=6.0, text='Sing it back')], 0)
        self.words = [dict(text=text, start=start, end=start + 0.4, confidence=0.9)
                      for text, start in [('Hello', 1.0), ('little', 1.6), ('world', 2.2), ('Sing', 4.0), ('it', 4.6), ('back', 5.2)]]
        # The melody guide's notes: "Hello" sung across two notes, "world" and "it" where it found none.
        self.notes = [[1.0, 1.3, 64], [1.3, 1.55, 65], [1.6, 2.1, 67], [4.0, 4.5, 60], [5.2, 5.9, 62]]

    def test_header_names_the_song_its_audio_and_its_timing(self):
        text = render_ultrastar(self.project, self.words, None, 'en', self.notes, audio='Nina - Blue Skies.mp3',
                                instrumental='Nina - Blue Skies [INSTR].mp3', vocals='Nina - Blue Skies [VOC].mp3')
        header = text.splitlines()[:9]
        self.assertEqual(header, ['#TITLE:Blue Skies', '#ARTIST:Nina', '#ENCODING:UTF8', '#LANGUAGE:English', '#MP3:Nina - Blue Skies.mp3',
                                  '#INSTRUMENTAL:Nina - Blue Skies [INSTR].mp3', '#VOCALS:Nina - Blue Skies [VOC].mp3', f'#BPM:{BPM}', '#GAP:1000'])
        self.assertTrue(text.endswith('E\n'))

    def test_each_word_takes_the_notes_sung_during_it_and_freestyle_where_none_was_found(self):
        lines = notes_of(render_ultrastar(self.project, self.words, None, None, self.notes))
        # Beats of 37.5 ms from the first word: "Hello" on E4 then held over F4, "little" on G4, "world" freestyle; then a
        # line break and the second line.
        self.assertEqual(lines, [': 0 8 4 Hello', ': 8 7 5 ~', ': 16 13 7  little', 'F 32 21 7  world', '- 53',
                                 ': 80 13 0 Sing', 'F 96 16 0  it', ': 112 19 2  back', 'E'])

    def test_notes_never_overlap_and_a_song_needs_words(self):
        project = update_project(self.project, self.project['title'], [dict(start=1.0, end=1.2, text='Oh'), dict(start=1.2, end=1.4, text='yeah')], 1)
        words = [dict(text='Oh', start=1.0, end=1.1, confidence=0.9), dict(text='yeah', start=1.2, end=1.3, confidence=0.9)]
        lines = notes_of(render_ultrastar(project, words, None, None, [[1.0, 1.4, 70]]))
        notes = [line.split(' ', 3) for line in lines if line[0] in ':F']
        ends = [int(start) + int(length) for _, start, length, _ in notes]
        starts = [int(start) for _, start, _, _ in notes]
        self.assertTrue(all(later >= end for end, later in zip(ends, starts[1:])), lines)
        self.assertTrue(all(int(length) >= 1 for _, _, length, _ in notes))
        with self.assertRaises(ValueError):
            render_ultrastar(update_project(self.project, 'x', [], 2))

    def test_spaceless_scripts_join_and_names_are_split_into_artist_and_title(self):
        project = update_project(self.project, '月亮', [dict(start=1.0, end=2.0, text='我爱你')], 1)
        lines = notes_of(render_ultrastar(project, [], None, None, [[1.0, 2.0, 62]]))
        self.assertEqual([line.split(' ', 4)[-1] for line in lines if line[0] in ':F'], ['我', '爱', '你'])
        self.assertEqual(artist_and_title('Nina - Blue Skies'), ('Nina', 'Blue Skies'))
        self.assertEqual(artist_and_title('Untitled demo'), ('Unknown artist', 'Untitled demo'))
        self.assertEqual(song_name(update_project(self.project, 'AC/DC - Back: In Black?', self.project['cues'], 1)), 'AC DC - Back In Black')

    def test_assigned_singers_have_separate_absolute_tracks(self):
        cues = [{**cue, 'singer': index + 1} for index, cue in enumerate(self.project['cues'])]
        project = update_project(self.project, self.project['title'], cues, 1)
        text = render_ultrastar(project, self.words, None, None, self.notes)
        self.assertIn('#P1:Singer 1\n#P2:Singer 2\n', text)
        self.assertIn('\nP1\n', text)
        self.assertIn('\nP2\n', text)
        first, second = text.split('\nP1\n')[1].split('\nP2\n')
        self.assertEqual(first.splitlines(), [': 0 8 4 Hello', ': 8 7 5 ~', ': 16 13 7  little', 'F 32 21 7  world'])
        self.assertEqual(second.splitlines(), [': 80 13 0 Sing', 'F 96 16 0  it', ': 112 19 2  back', 'E'])
        self.assertIn('#GAP:1000\n', text)

    def test_shared_lines_reach_both_singers_with_independent_phrase_breaks(self):
        cues = [dict(start=1, end=2, text='One', singer=1), dict(start=3, end=4, text='Two', singer=2),
                dict(start=5, end=6, text='Together', singer='both'), dict(start=7, end=8, text='Anyone')]
        project = update_project(self.project, self.project['title'], cues, 1)
        text = render_ultrastar(project, notes=[[1, 2, 60], [3, 4, 64], [5, 6, 67], [7, 8, 69]])
        self.assertIn('\nP1\n', text)
        self.assertIn('\nP2\n', text)
        first, second = text.split('\nP1\n')[1].split('\nP2\n')
        self.assertEqual(first.splitlines(), [': 0 27 0 One', '- 27', ': 107 26 7 Together', '- 133', ': 160 27 9 Anyone'])
        self.assertEqual(second.splitlines(), [': 53 27 4 Two', '- 80', ': 107 26 7 Together', '- 133', ': 160 27 9 Anyone', 'E'])

    def test_second_singer_can_start_the_song_and_shared_spaceless_lines_keep_their_words(self):
        project = update_project(self.project, 'Song', [dict(start=1, end=2, text='Two', singer=2), dict(start=5, end=6, text='One', singer=1)], 1)
        text = render_ultrastar(project)
        self.assertIn('\nP1\n', text)
        self.assertIn('\nP2\n', text)
        first, second = text.split('\nP1\n')[1].split('\nP2\n')
        self.assertTrue(first.startswith('F 107 '), text)
        self.assertTrue(second.startswith('F 0 '), text)
        shared = update_project(self.project, 'Song', [dict(start=1, end=2, text='我爱你', singer='both')], 1)
        text = render_ultrastar(shared)
        self.assertIn('\nP1\n', text)
        self.assertIn('\nP2\n', text)
        first, second = text.split('\nP1\n')[1].split('\nP2\n')
        for track in (first, second):
            self.assertEqual([line.split(' ', 4)[-1] for line in track.splitlines() if line.startswith('F ')], ['我', '爱', '你'])

    def test_packed_word_starts_cannot_shift_a_shared_line_apart_between_singers(self):
        cues = [dict(start=1, end=3, text='a b c d e f g', singer=1,
                     wordStarts=[1, 2.95, 2.955, 2.96, 2.965, 2.97, 2.975]),
                dict(start=3, end=3.3, text='Both', singer='both')]
        project = update_project(self.project, 'Song', cues, 1)
        with self.assertRaisesRegex(ValueError, 'shared line.*precision'):
            render_ultrastar(project, notes=[[3, 3.3, 65]])
        # The single-voice exporter retains its existing quantization behavior.
        mono = update_project(self.project, 'Song', [{**cue, 'singer': 1} for cue in cues], 1)
        self.assertIn(': 58 3 5 Both', render_ultrastar(mono, notes=[[3, 3.3, 65]]))

    def test_word_starts_that_fit_before_a_shared_boundary_keep_both_copies_identical(self):
        project = update_project(self.project, 'Song', [
            dict(start=1, end=3, text='a b c d e f g', singer=1, wordStarts=[1, 2.75, 2.79, 2.83, 2.87, 2.91, 2.95]),
            dict(start=3, end=3.3, text='Both', singer='both')], 1)
        text = render_ultrastar(project, notes=[[3, 3.3, 65]])
        first, second = text.split('\nP1\n')[1].split('\nP2\n')
        for track in (first, second):
            self.assertIn(': 53 8 5 Both', track.splitlines())

    def test_a_single_populated_singer_stays_solo_without_an_empty_track(self):
        for singer in (1, 2):
            project = update_project(self.project, 'Song', [{**cue, 'singer': singer} for cue in self.project['cues']], 1)
            text = render_ultrastar(project, self.words, None, None, self.notes)
            self.assertNotIn('\nP1\n', text)
            self.assertNotIn('\nP2\n', text)
            self.assertEqual(len([line for line in text.splitlines() if line.startswith('- ')]), 1)
            self.assertEqual([line.split(' ', 4)[-1].strip() for line in notes_of(text) if line.startswith((': ', 'F '))], ['Hello', '~', 'little', 'world', 'Sing', 'it', 'back'])

    def test_the_song_is_zipped_in_its_own_folder_with_its_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            sources = {kind: work / f'{kind}.wav' for kind in ('original', 'backing', 'vocals')}
            for path in sources.values():
                path.write_bytes(b'RIFF')
            encoded = []
            def encode(source: Path, target: Path) -> None:
                encoded.append(source.name)
                target.write_bytes(b'ID3' + source.name.encode())
            stages = []
            output = export_ultrastar(self.project, sources, work, encode, threading.Event(), stages.append, words=self.words, notes=self.notes)
            self.assertEqual(encoded, ['original.wav', 'backing.wav', 'vocals.wav'])
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(sorted(archive.namelist()), ['Nina - Blue Skies/Nina - Blue Skies [INSTR].mp3', 'Nina - Blue Skies/Nina - Blue Skies [VOC].mp3',
                                                              'Nina - Blue Skies/Nina - Blue Skies.mp3', 'Nina - Blue Skies/Nina - Blue Skies.txt'])
                text = archive.read('Nina - Blue Skies/Nina - Blue Skies.txt').decode('utf-8')
                self.assertIn('#MP3:Nina - Blue Skies.mp3', text)
                self.assertEqual(archive.read('Nina - Blue Skies/Nina - Blue Skies [VOC].mp3'), b'ID3vocals.wav')
            self.assertEqual(len(stages), 3)
            cancelled = threading.Event()
            cancelled.set()
            with self.assertRaises(RuntimeError):
                export_ultrastar(self.project, sources, work, encode, cancelled, stages.append, notes=self.notes)


if __name__ == '__main__':
    unittest.main()
