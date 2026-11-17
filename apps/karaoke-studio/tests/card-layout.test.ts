import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_LAYOUTS, cardLayout, isVideoSize } from '../src/card-layout.ts';

test('a vertical video is laid out upright; HD, Full HD and anything unknown lie flat', () => {
  assert.equal(cardLayout('vertical'), CARD_LAYOUTS.portrait);
  for (const size of ['720p', '1080p', '4k', '']) assert.equal(cardLayout(size), CARD_LAYOUTS.landscape, size);
  assert.deepEqual(['720p', '1080p', 'vertical', '4k', 'toString'].map(isVideoSize), [true, true, true, false, false]);
});

test('each layout keeps its parts in order down the card, inside it, and its lines narrower than it', () => {
  for (const [name, place] of Object.entries(CARD_LAYOUTS)) {
    const line = [place.title, place.middle - place.room / 2, place.middle + place.room / 2, place.next, place.footer, place.height];
    assert.deepEqual(line, [...line].sort((a, b) => a - b), name);
    const said = [place.title, place.saidMiddle - place.saidRoom / 2, place.saidMiddle + place.saidRoom / 2, place.said, place.next];
    assert.deepEqual(said, [...said].sort((a, b) => a - b), name);
    assert.ok(place.middle < place.dots && place.dots < place.next, name);
    assert.ok(place.wrap < place.width, name);
  }
});
