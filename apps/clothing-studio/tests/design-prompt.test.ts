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
