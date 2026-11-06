import test from 'node:test';
import assert from 'node:assert/strict';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { legMeasurements, template, topMeasurements } from '../src/product.ts';

const scope = (reading: ReturnType<typeof readDesignPrompt>, label: string) => reading.scopes.find(item => item.label === label)?.understood;

test('named parts take their own clause; the rest styles the whole garment, rib trims staying rib and plain', () => {
  const reading = readDesignPrompt('white tee with navy sleeves and cuffs, breton stripe body', template('crew-sweat'));
  assert.equal(reading.product.base, 'tee');
  assert.equal(reading.product.parts.sleeveLeft.color, '#1f2a4f');
  assert.equal(reading.product.parts.front.print?.motif, 'stripe');
  assert.equal(reading.product.parts.neckband.material, 'rib-220');
  assert.equal(reading.product.parts.neckband.print, null);
  assert.ok(reading.ignored.includes('left cuff (not on this t-shirt)'), reading.ignored.join());
  const sweat = readDesignPrompt('grey body and navy sleeves and cuffs', template('crew-sweat'));
  assert.deepEqual(scope(sweat, 'Left sleeve, Right sleeve, Left cuff, Right cuff'), ['colour: navy']);
  assert.deepEqual(scope(sweat, 'Front body, Back body'), ['colour: grey']);
});

test('garment words set neckline, sleeves, hem, chest pocket and fit, and the same fit twice changes nothing more', () => {
  const reading = readDesignPrompt('boxy v-neck long sleeve tee with a curved hem and a chest pocket', template('blank'));
  const m = topMeasurements(reading.product);
  assert.deepEqual([reading.product.neckline, m.sleeve, m.chest, reading.product.options], ['v', 60, topMeasurements(template('blank')).chest + 12, { hem: 'curved', chestPocket: true }]);
  assert.deepEqual(readDesignPrompt('boxy', reading.product).product.measurements, reading.product.measurements);
  // A hoodie has no V-neck or chest pocket; that is reported rather than forced.
  const hoodie = readDesignPrompt('v-neck hoodie with a chest pocket', template('blank'));
  assert.equal(hoodie.product.neckline, 'crew');
  assert.deepEqual(hoodie.ignored, ['V-neck (not available on a pullover hoodie)', 'chest pocket (a hoodie has a kangaroo pocket)']);
});

test('trouser words change leg length and width within the pattern limits', () => {
  const shorts = readDesignPrompt('wide leg shorts in sand linen', template('trousers'));
  assert.equal(legMeasurements(shorts.product).inseam, 18);
  assert.ok(legMeasurements(shorts.product).legOpening <= legMeasurements(shorts.product).hip * 0.8);
  assert.equal(shorts.product.parts.front.material, 'linen-170');
  assert.equal(legMeasurements(readDesignPrompt('slim cropped trousers', template('trousers')).product).inseam, 58);
});

test('a description with nothing applicable is refused without changing the design', () => {
  assert.throws(() => readDesignPrompt('sparkly unicorn vibes', template('blank')), /could be applied/);
  assert.throws(() => readDesignPrompt('   ', template('blank')), /Describe the garment/);
});

test('explicit centimetre and millimetre measurements shape tops without changing the source', () => {
  const source = template('blank'), before = structuredClone(source);
  const reading = readDesignPrompt('navy tee, chest 110 cm, 700 mm length, sleeves 25 cm', source);
  assert.deepEqual(topMeasurements(reading.product), { chest: 110, length: 70, sleeve: 25 });
  assert.equal(reading.product.parts.front.color, '#1f2a4f');
  assert.ok(scope(reading, 'Garment')?.includes('chest: 110 cm'));
  assert.deepEqual(reading.ignored, []);
  assert.deepEqual(source, before);
});

test('explicit trouser and skirt measurements retain their categories and validate together', () => {
  const trousers = readDesignPrompt('linen trousers, waist 82 cm, hip 108 cm, inseam 740 mm, leg opening 44 cm', template('trousers'));
  assert.deepEqual(legMeasurements(trousers.product), { waist: 82, hip: 108, rise: 28, inseam: 74, legOpening: 44 });
  assert.deepEqual(trousers.ignored, []);
  const skirt = readDesignPrompt('navy skirt, waist 78 cm, hem 180 cm, slant 620 mm', template('flared-skirt'));
  assert.deepEqual(skirt.product.measurements, { waist: 78, hem: 180, slant: 62 });
});

test('invalid or contradictory dimensions refuse atomically and unsupported ones stay visible', () => {
  const source = template('blank'), before = structuredClone(source);
  assert.throws(() => readDesignPrompt('red tee chest 10 cm', source));
  assert.throws(() => readDesignPrompt('chest 100 cm, chest 110 cm', source), /conflicting/i);
  assert.deepEqual(source, before);
  const reading = readDesignPrompt('navy tee waist 80 cm', source);
  assert.deepEqual(reading.product.measurements, source.measurements);
  assert.ok(reading.ignored.some(word => word.includes('waist')));
});

test('dimensions remain separate from print repeats and sleeve removal updates the linked parts', () => {
  const source = template('blank');
  const reading = readDesignPrompt('navy stripes 6 cm, chest 110 cm, 1100 mm chest, sleeves 0 cm', source);
  assert.equal(topMeasurements(reading.product).chest, 110);
  assert.equal(topMeasurements(reading.product).sleeve, 0);
  assert.equal(reading.product.parts.front.print?.scaleCm, 6);
  assert.equal(reading.product.parts.sleeveLeft, undefined);
  assert.equal(reading.product.parts.sleeveRight, undefined);
  assert.throws(() => readDesignPrompt('navy tee, sleeves -1 cm', source));
  assert.equal(topMeasurements(source).sleeve, 21);
});

test('comma-delimited dimensions keep their sign and unsupported values cannot become print repeats', () => {
  const source = template('blank');
  assert.equal(topMeasurements(readDesignPrompt('navy tee,100 cm chest', source).product).chest, 100);
  for (const value of ['-100', '10', '+10']) assert.throws(() => readDesignPrompt(`red tee,${value} cm chest`, source));
  const printed = readDesignPrompt('navy stripes,100 cm hip', source);
  assert.equal(printed.product.parts.front.print?.scaleCm, 2);
  assert.ok(printed.ignored.some(word => word.includes('100 cm hip')));
  // A decimal comma must not be reinterpreted as its fractional suffix.
  assert.equal(topMeasurements(readDesignPrompt('navy tee,10,100 cm chest', source).product).chest, 104);
});

test('measured sleeves retain the color scope in the same clause', () => {
  const reading = readDesignPrompt('navy tee with red sleeves 25 cm', template('blank'));
  assert.equal(topMeasurements(reading.product).sleeve, 25);
  assert.equal(reading.product.parts.front.color, '#1f2a4f');
  assert.equal(reading.product.parts.sleeveLeft.color, '#b23a2e');
  assert.equal(reading.product.parts.sleeveRight.color, '#b23a2e');
  assert.deepEqual(reading.ignored, []);
});

test('named fit points in cm and mm shape a top and preserve its color scopes', () => {
  const source = template('blank'), before = structuredClone(source);
  const reading = readDesignPrompt('navy tee, shoulder width 46 cm, 40 mm shoulder drop, neck width 20 cm, front neck drop 12 cm, back neck drop 3 cm, armhole depth 23 cm, hem width 56 cm, red sleeves', source);
  assert.deepEqual(reading.product.fit, {shoulderWidth:46,shoulderDrop:4,neckWidth:20,frontNeckDrop:12,backNeckDrop:3,armholeDepth:23,hemWidth:56});
  assert.ok(scope(reading, 'Garment')?.includes('shoulder width: 46 cm'));
  assert.equal(reading.product.parts.front.color,'#1f2a4f');
  assert.equal(reading.product.parts.sleeveLeft.color,'#b23a2e');
  assert.deepEqual(reading.ignored,[]);
  assert.deepEqual(source,before);
});

test('combined fit points must be geometrically valid and unsupported points do not change repeat size', () => {
  const source = template('blank'), before = structuredClone(source);
  assert.throws(() => readDesignPrompt('red tee, shoulder width 30 cm, neck width 28 cm', source), /neck.*narrower/i);
  assert.throws(() => readDesignPrompt('neck width 22 cm, 210 mm neck width', source), /conflicting/i);
  assert.deepEqual(source,before);
  const reading = readDesignPrompt('navy striped trousers, shoulder width 46 cm', template('trousers'));
  assert.equal(reading.product.parts.front.print?.scaleCm,2);
  assert.ok(reading.ignored.some(word=>word.includes('shoulder width 46 cm')));
});

test('equivalent decimal dimensions agree across units, and chest and hem validate together', () => {
  const source = { ...template('blank'), measurements: { chest: 90, length: 70, sleeve: 21 }, fit: { hemWidth: 35 } };
  assert.throws(() => readDesignPrompt('chest 130 cm', source), /hem width/i);
  assert.throws(() => readDesignPrompt('hem width 90 cm', source), /hem width/i);
  const reading = readDesignPrompt('chest 130 cm, hem width 90 cm, shoulder width 44.01 cm, 440.1 mm shoulder width', source);
  assert.equal(topMeasurements(reading.product).chest, 130);
  assert.deepEqual(reading.product.fit, { hemWidth: 90, shoulderWidth: 44.01 });
  const skirt = readDesignPrompt('navy skirt, 160 cm hem width', template('flared-skirt'));
  assert.deepEqual(skirt.product.measurements, { ...template('flared-skirt').measurements, hem: 160 });
  assert.deepEqual(skirt.ignored, []);
});
