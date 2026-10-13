import test from 'node:test';
import assert from 'node:assert/strict';
import { createWaterSheep } from '../src/web/watersheep.js';

// Word-level fake tokenizer and an ONNX session that scores each option by a lookup.
const vocabulary = new Map();
const tokenizer = { encode: text => ({ ids: text.split(/\s+/).filter(Boolean).map(word => { if (!vocabulary.has(word)) vocabulary.set(word, 100 + vocabulary.size); return vocabulary.get(word); }) }) };
const special = { cls: 1, sep: 2, mask: 3 };
const ort = { Tensor: class { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } } };
const meta = { max_len: 64, max_question_tokens: 16, max_option_tokens: 6, max_options: 10, temperatures: { choice: 2, binary: 0.5 } };

function session(score) {
  const runs = [];
  return {
    runs,
    async run(feeds) {
      runs.push(feeds);
      const ids = Array.from(feeds.input_ids.data, Number), positions = Array.from(feeds.option_positions.data, Number);
      // The option is the tokens after its mask up to the next mask or separator.
      return { logits: { data: Float32Array.from(positions.map(at => { const words = []; for (let i = at + 1; i < ids.length && ids[i] > 3; i++) words.push(ids[i]); return score(words); })) } };
    },
  };
}
const id = word => tokenizer.encode(word).ids[0];

test('records use the reference layout: CLS, tagged question, SEP, one MASK per option, SEP, state, SEP', () => {
  const model = createWaterSheep({ ort, session: session(() => 0), tokenizer, special, meta });
  const { ids, positions } = model.encodeRecord('which one', ['open', 'close'], 'open it');
  assert.deepEqual(ids, [1, id('[choose]'), id('which'), id('one'), 2, 3, id('open'), 3, id('close'), 2, id('open'), id('it'), 2]);
  assert.deepEqual(positions, [5, 7]);
  assert.equal(model.encodeRecord('q', ['yes', 'no'], '', 'binary').ids[1], id('[yes/no]'));
  // Too long: the record is cut to max_len and options past the cut are reported missing.
  const long = model.encodeRecord('q', Array.from({ length: 12 }, (_, i) => `w${i} `.repeat(6)), '');
  assert.ok(long.ids.length <= meta.max_len && long.positions.length < 12);
});

test('choices use the calibrated temperature, int64 feeds, and long lists are scored in groups', async () => {
  const fake = session(words => (words[0] === id('right') ? 4 : 0));
  const model = createWaterSheep({ ort, session: fake, tokenizer, special, meta });
  const two = await model.decide('s', 'q', ['right', 'wrong']);
  assert.equal(two.index, 0);
  assert.ok(Math.abs(two.probs[0] - 1 / (1 + Math.exp(-4 / 2))) < 1e-6, 'logits divided by the choice temperature');
  assert.equal(fake.runs[0].input_ids.type, 'int64');
  assert.ok(fake.runs[0].input_ids.data instanceof BigInt64Array);
  const options = Array.from({ length: 23 }, (_, i) => (i === 17 ? 'right' : `other${i}`));
  const many = await model.decide('s', 'q', options);
  assert.equal(many.index, 17);
  assert.ok(Math.abs(many.probs.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(fake.runs.length > 3, 'groups plus a final round');
  assert.ok(fake.runs.every(feeds => feeds.option_positions.dims[1] <= 10));
  const yes = await createWaterSheep({ ort, session: session(words => (words[0] === id('yes') ? 1 : 0)), tokenizer, special, meta }).yes('s', 'q');
  assert.ok(Math.abs(yes - 1 / (1 + Math.exp(-1 / 0.5))) < 1e-6, 'yes/no uses the binary temperature');
  await assert.rejects(model.decide('s', 'q', ['only']), /at least two/);
  assert.throws(() => createWaterSheep({ ort, session: fake, tokenizer, special: { cls: 1 }, meta }), /CLS\/SEP\/MASK/);
});
