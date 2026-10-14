import test from 'node:test';
import assert from 'node:assert/strict';
import { readStylePrompt } from '../src/style-prompt.ts';
import type { PartStyle } from '../src/product.ts';

const blank: PartStyle = { material: 'jersey-180', color: '#f4f2ec', print: null };

test('a full description sets fabric, ground, print, print colour and repeat', () => {
  const { style, understood, ignored } = readStylePrompt('Navy breton stripe on heavyweight ecru jersey', blank);
  assert.deepEqual(style, { material: 'jersey-240', color: '#efe8d8', print: { motif: 'stripe', color: '#1f2a4f', scaleCm: 2, layout: 'grid' } });
  assert.ok(understood.includes('fabric: Heavyweight jersey') && understood.includes('print colour: navy') && understood.includes('colour: ecru'));
  assert.deepEqual(ignored, []);
});

test('colour roles: "X on Y", the colour nearest the motif, and a single colour without a motif', () => {
  assert.equal(readStylePrompt('white polka dots on black', blank).style.color, '#1c1c1e');
  assert.equal(readStylePrompt('white polka dots on black', blank).style.print!.color, '#f7f7f4');
  const sage = readStylePrompt('sage linen with a cream floral', blank).style;
  assert.deepEqual([sage.material, sage.color, sage.print!.motif, sage.print!.color], ['linen-170', '#9fae91', 'floral', '#f1e8d0']);
  assert.deepEqual(readStylePrompt('olive', blank).style, { ...blank, color: '#6b6b3a' });
  // A colour alone with a motif colours the print and keeps the ground.
  assert.deepEqual(readStylePrompt('red gingham', blank).style.color, blank.color);
  assert.equal(readStylePrompt('red gingham', blank).style.print!.color, '#b23a2e');
  assert.equal(readStylePrompt('#123abc', blank).style.color, '#123abc');
});

test('modifiers, multi-word colours, sizes and layouts', () => {
  const pale = readStylePrompt('pale pink', blank).style.color, pink = readStylePrompt('pink', blank).style.color;
  assert.notEqual(pale, pink);
  assert.equal(readStylePrompt('navy blue', blank).style.color, '#1f2a4f');
  assert.equal(readStylePrompt('heather grey terry', blank).style.color, '#b7b4ad');
  const print = readStylePrompt('small ditsy floral, half-drop', blank).style.print!;
  assert.deepEqual([print.motif, print.scaleCm, print.layout], ['floral', 3, 'half-drop']);
  assert.equal(readStylePrompt('big mirrored waves', blank).style.print!.layout, 'mirror');
  assert.equal(readStylePrompt('stripes 12 mm', blank).style.print!.scaleCm, 2, 'sizes are kept within the library limits');
  assert.equal(readStylePrompt('geometric 25 cm', blank).style.print!.scaleCm, 25);
});

test('only what was described changes, and plain removes a print', () => {
  const printed: PartStyle = { material: 'linen-170', color: '#9fae91', print: { motif: 'floral', color: '#ffffff', scaleCm: 7, layout: 'half-drop' } };
  assert.deepEqual(readStylePrompt('mustard', printed).style, { ...printed, color: '#d1a72f' });
  assert.deepEqual(readStylePrompt('make the print large', printed).style.print, { ...printed.print!, scaleCm: 10 });
  assert.deepEqual(readStylePrompt('plain', printed).style, { ...printed, print: null });
  assert.equal(readStylePrompt('denim', blank).style.material, 'denim-340');
  assert.equal(readStylePrompt('washed indigo denim', blank).style.material, 'denim-340');
});

test('unknown words are reported, and a description with nothing usable is refused', () => {
  assert.deepEqual(readStylePrompt('sparkly navy velvet', blank).ignored, ['sparkly', 'velvet']);
  assert.throws(() => readStylePrompt('something nice', blank), /No fabric, colour or print/);
  assert.throws(() => readStylePrompt('   ', blank), /Describe a fabric/);
});

test('accents and synonyms are understood together, and modifiers keep light colours visible', () => {
  const polo = readStylePrompt('emerald piqué polo', blank);
  assert.deepEqual([polo.style.material, polo.ignored], ['pique-200', []]);
  const lilac = readStylePrompt('pastel lilac gingham on white', blank).style.print!.color;
  assert.notEqual(lilac, '#f7f7f4');
  assert.ok(parseInt(lilac.slice(1, 3), 16) < 235, 'a pastel lilac is still lilac, not white');
});

test('stripe direction is explicit, preserved when omitted and never claimed for another motif', () => {
  const result = readStylePrompt('navy vertical stripes', blank);
  assert.equal(Reflect.get(result.style.print!, 'direction'), 'vertical');
  assert.deepEqual(result.ignored, []);
  assert.ok(result.understood.includes('stripe direction: vertical'));
  assert.equal(Reflect.get(readStylePrompt('stripes 5 cm', result.style).style.print!, 'direction'), 'vertical');
  assert.notEqual(Reflect.get(readStylePrompt('horizontal stripes', result.style).style.print!, 'direction'), 'vertical');
  assert.equal(Reflect.get(readStylePrompt('dots', result.style).style.print!, 'direction'), undefined);
  assert.deepEqual(readStylePrompt('vertical dots', blank).ignored, ['vertical']);
});

test('conflicting stripe directions are refused instead of committing the first word', () => {
  for (const prompt of ['change horizontal stripes to vertical','not horizontal, vertical stripes','vertical and horizontal stripes'])
    assert.throws(() => readStylePrompt(prompt,blank), /Specify one stripe direction/);
});
