import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_LAYOUTS } from '../src/card-layout.ts';
import { GUIDE_PAST, GUIDE_SECONDS, barBox, guideLane, parseNotes, pitchRange, visibleBars, withGuide, type Note } from '../src/melody-guide.ts';

test('the lane spans most of the song\'s notes and at least an octave, higher notes higher', () => {
  assert.deepEqual(pitchRange([]), [54, 66]);
  assert.deepEqual(pitchRange([[0, 1, 60], [1, 2, 72]]), [58, 74]);
  // A stray low note does not stretch the lane: it stays on the lane's lower edge.
  const notes: Note[] = Array.from({ length: 40 }, (_, i) => [i, i + 0.5, 60 + (i % 8)] as Note);
  notes[3] = [3, 3.5, 30];
  const [low, high] = pitchRange(notes);
  assert.deepEqual([low, high], [58, 70]);
  assert.ok(barBox(67, low, high, 104)[0] < barBox(60, low, high, 104)[0]);
  assert.deepEqual(barBox(30, low, high, 104), barBox(low, low, high, 104));
});

test('notes from the studio are read only when they are [start, end, MIDI note] in order', () => {
  assert.deepEqual(parseNotes([[0, 1, 60], [1, 2.5, 62]]), [[0, 1, 60], [1, 2.5, 62]]);
  for (const value of [null, {}, [[1, 0.5, 60]], [[0, 1, 60], [0.5, 2, 62]], [[0, 1, 60.5]], [[0, 1, 200]], [[0, 1]], [['0', 1, 60]], [[0, Infinity, 60]]]) {
    assert.equal(parseNotes(value), null, JSON.stringify(value));
  }
});

test('the lane shows five seconds of notes, one of them sung, a note sung now at the playhead', () => {
  const place = CARD_LAYOUTS.landscape, lane = guideLane(place), notes: Note[] = [[0, 0.4, 59], [0.2, 0.7, 60], [1, 2, 62], [2.5, 3, 64], [5.6, 8, 65]];
  assert.equal(lane.pps * GUIDE_SECONDS, place.wrap);
  assert.equal(lane.playhead - lane.left, place.wrap * GUIDE_PAST / GUIDE_SECONDS);
  assert.deepEqual(visibleBars(notes, 1.5, place).map(bar => bar.pitch), [60, 62, 64]);
  const [now] = visibleBars([[1.5, 2, 60]], 1.5, place);
  assert.equal(now!.x0, lane.playhead);
  assert.equal(now!.x1 - now!.x0, 0.5 * lane.pps);
});

test('with the guide, its lane lies between the title and the line being sung in both layouts', () => {
  for (const [name, place] of Object.entries(CARD_LAYOUTS)) {
    const guide = withGuide(place);
    assert.ok(guide.title + 40 < guide.laneTop, name);
    assert.ok(guide.laneBottom <= guide.middle - guide.room / 2 + 1, name);
    assert.ok(guide.laneBottom <= guide.saidMiddle - guide.saidRoom / 2 + 1, name);
    assert.ok(guide.middle + guide.room / 2 < guide.next, name);
  }
});
