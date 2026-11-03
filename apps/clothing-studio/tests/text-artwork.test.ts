import test from 'node:test';
import assert from 'node:assert/strict';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { template, topMeasurements } from '../src/product.ts';
import { contrastingInk, readSlogan, textArtwork, textLines } from '../src/text-artwork.ts';

test('words in quotes are read as text to print, with where it goes and its colour', () => {
  const read = (said: string) => { const found = readSlogan(said); return found && { ...found.request, rest: found.rest.replace(/\s+/g, ' ').trim() }; };
  assert.deepEqual(read('black tee with "Stay Wild" on the back in white letters'), { text: 'Stay Wild', side: 'back', color: '#f7f7f4', font: 'sans', rest: 'black tee' });
  assert.deepEqual(read('navy hoodie with “Northwind Books” across the chest'), { text: 'Northwind Books', side: 'front', color: null, font: 'sans', rest: 'navy hoodie' });
  assert.equal(read('white tee printed with "GOOD VIBES ONLY" in red')?.color, '#b23a2e');
  assert.equal(read('cream sweatshirt with the words "Be Kind" on the front in forest green lettering')?.rest, 'cream sweatshirt');
  assert.equal(read('a plain navy tee'), null);
  assert.throws(() => readSlogan(`tee with "${'x'.repeat(41)}"`), /up to 40 characters/);
});

test('a described garment carries its text, in a colour that reads on the garment', () => {
  const black = readDesignPrompt('black tee with "Stay Wild" on the back', template('blank'));
  assert.equal(contrastingInk(black.product.parts.front.color), '#f8f6f0', 'the tee is now dark');
  assert.deepEqual(black.text, { text: 'Stay Wild', side: 'back', color: '#f8f6f0', font: 'sans' });
  assert.ok(black.scopes.some(scope => scope.label === 'Artwork' && scope.understood[0] === 'text “Stay Wild” on the back'));
  assert.ok(!black.ignored.some(word => /stay|wild/i.test(word)), 'the quoted words are not read as garment words');
  // On a light garment the text is dark; a quote alone is enough to describe.
  assert.equal(readDesignPrompt('"hello"', template('blank')).text?.color, '#1b1c1b');
  // Bottoms carry no artwork.
  const trousers = readDesignPrompt('navy trousers with "Team 7" on the back', template('trousers'));
  assert.equal(trousers.text, undefined);
  assert.ok(trousers.ignored.some(item => item.includes('Team 7')));
});

test('text is laid out on short lines and placed like uploaded artwork', () => {
  assert.deepEqual(textLines('Northwind Books and Coffee Since 1999'), ['Northwind Books and', 'Coffee Since 1999']);
  assert.deepEqual(textLines('Stay Wild'), ['Stay Wild']);
  assert.equal(contrastingInk('#1f2a44'), '#f8f6f0');
  assert.equal(contrastingInk('#f4f2ec'), '#1b1c1b');
  const tee = template('blank'), art = textArtwork({ text: 'Stay Wild', side: 'back', color: '#ffffff', font: 'sans' }, { dataUrl: 'data:image/png;base64,AA==', width: 800, height: 240 }, topMeasurements(tee).chest);
  assert.deepEqual([art.part, art.name, art.xCm, art.yCm, art.widthCm], ['back', 'Text: Stay Wild', 0, 12, Math.min(24, topMeasurements(tee).chest / 4)]);
});
