// WaterSheep single-choice decisions with an injected ONNX runtime and tokenizer.
// Adapted from watersheep.js (WaterSheep, Apache-2.0, https://github.com/SamratDuttaOfficial/WaterSheep,
// gh-pages e70bf94): the same input layout, calibrated temperatures and grouping of long option lists,
// limited to single-choice and yes/no questions. The runtime is injected so the same code runs under Node for
// evaluation (onnxruntime-node) and in a browser (onnxruntime-web) without fetching code at run time.

const TYPE_TAG = { choice: '[choose]', binary: '[yes/no]' };

/**
 * @param {object} runtime
 * @param {object} runtime.ort        onnxruntime module (provides Tensor)
 * @param {object} runtime.session    InferenceSession for onnx/model_quantized.onnx
 * @param {object} runtime.tokenizer  @huggingface/tokenizers Tokenizer for the model
 * @param {object} runtime.special    { cls, sep, mask } token ids
 * @param {object} runtime.meta       the model's watersheep.json
 */
export function createWaterSheep({ ort, session, tokenizer, special, meta }) {
  for (const key of ['cls', 'sep', 'mask']) if (!Number.isInteger(special?.[key])) throw new Error('The WaterSheep tokenizer has no CLS/SEP/MASK tokens.');
  const encode = text => tokenizer.encode(text || '', { add_special_tokens: false }).ids;
  let queue = Promise.resolve();

  function encodeRecord(question, options, state, type = 'choice') {
    const { cls, sep, mask } = special;
    const q = encode(`${TYPE_TAG[type]} ${question}`).slice(0, meta.max_question_tokens);
    const s = encode(state);
    let ids = [cls, ...q, sep];
    let positions = [];
    for (const option of options) {
      positions.push(ids.length);
      ids.push(mask, ...encode(option).slice(0, meta.max_option_tokens));
    }
    ids.push(sep);
    const room = meta.max_len - ids.length - 1;
    if (room > 0 && s.length) ids.push(...s.slice(0, room));
    ids.push(sep);
    if (ids.length > meta.max_len) {
      ids = [...ids.slice(0, meta.max_len - 1), sep];
      positions = positions.filter(position => position < meta.max_len - 1);
    }
    return { ids, positions };
  }

  async function logits(question, options, state, type) {
    const { ids, positions } = encodeRecord(question, options, state, type);
    // Options cut off by the length limit cannot be scored; the caller retries in smaller groups.
    if (positions.length !== options.length) return null;
    const i64 = values => BigInt64Array.from(values, value => BigInt(value));
    const feeds = {
      input_ids: new ort.Tensor('int64', i64(ids), [1, ids.length]),
      attention_mask: new ort.Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]),
      option_positions: new ort.Tensor('int64', i64(positions), [1, positions.length]),
      option_mask: new ort.Tensor('int64', new BigInt64Array(positions.length).fill(1n), [1, positions.length]),
    };
    const job = queue.then(() => session.run(feeds));
    queue = job.catch(() => {});
    return Array.from((await job).logits.data, Number);
  }

  const softmax = (values, type) => {
    const temperature = Math.max(1e-6, meta.temperatures?.[type] ?? 1);
    const scaled = values.map(value => value / temperature), top = Math.max(...scaled);
    const exp = scaled.map(value => Math.exp(value - top)), sum = exp.reduce((a, b) => a + b, 0);
    return exp.map(value => value / sum);
  };

  // Long option lists are scored in groups; each group's best options go to a final round and the
  // rest are scaled relative to their group's finalist, as in the reference implementation.
  async function probabilities(question, options, state, type, size = 0) {
    const cap = Math.max(2, Math.min(10, Number(meta.max_options) || 10)), n = options.length;
    size = Math.min(size || cap, n);
    let groups, scores;
    for (;;) {
      if (n <= size) {
        const z = await logits(question, options, state, type);
        if (z) return softmax(z, type);
      } else {
        groups = [];
        for (let k = 0; k < n; k += size) groups.push(Array.from({ length: Math.min(n, k + size) - k }, (_, j) => k + j));
        scores = [];
        for (const group of groups) scores.push(await logits(question, group.map(i => options[i]), state, type));
        if (scores.every(Boolean)) break;
      }
      if (size <= 2) throw new Error('The options are too long for WaterSheep.');
      size = Math.max(2, size > 8 ? Math.min(size - 1, 8) : Math.floor(size / 2));
    }
    const keep = Math.max(1, Math.floor(size / groups.length)), local = {}, finalists = [];
    groups.forEach((group, g) => {
      const p = softmax(scores[g], type);
      group.forEach((i, k) => { local[i] = p[k]; });
      finalists.push(...p.map((value, k) => [value, k]).sort((a, b) => b[0] - a[0]).slice(0, keep).map(([, k]) => group[k]));
    });
    const final = await probabilities(question, finalists.map(i => options[i]), state, type, size);
    const result = new Array(n).fill(0);
    for (const group of groups) {
      const top = group.filter(i => finalists.includes(i)).reduce((a, b) => (local[b] > local[a] ? b : a));
      const scale = final[finalists.indexOf(top)] / Math.max(1e-12, local[top]);
      for (const i of group) result[i] = local[i] * scale;
    }
    finalists.forEach((i, k) => { result[i] = final[k]; });
    const sum = result.reduce((a, b) => a + b, 0);
    return result.map(value => value / sum);
  }

  return {
    encodeRecord,
    /** Calibrated probabilities for each option: { probs, index, confidence }. */
    async decide(state, question, options) {
      if (!Array.isArray(options) || options.length < 2) throw new Error('WaterSheep needs at least two options.');
      const probs = await probabilities(question, options.map(String), state ?? '', 'choice');
      const index = probs.reduce((best, value, i) => (value > probs[best] ? i : best), 0);
      return { probs, index, confidence: probs[index] };
    },
    /** Calibrated probability that the answer to a yes/no question is yes. */
    async yes(state, question) {
      return (await probabilities(question, ['yes', 'no'], state ?? '', 'binary'))[0];
    },
  };
}

/** WaterSheep from its parts: the runtime, the parsed metadata and tokenizer files, and a session. */
export function waterSheepFromFiles({ ort, Tokenizer, session, meta, tokenizerJson, tokenizerConfig }) {
  const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
  const special = {};
  for (const key of ['cls', 'sep', 'mask']) {
    const token = tokenizerConfig[`${key}_token`];
    special[key] = tokenizer.token_to_id(token && typeof token === 'object' ? token.content : token);
  }
  return createWaterSheep({ ort, session, tokenizer, special, meta });
}

/** Load WaterSheep from a local copy of the model repository (Node evaluation). */
export async function loadWaterSheepFromDirectory(directory, { ort, Tokenizer, readFile }) {
  const json = async name => JSON.parse(await readFile(`${directory}/${name}`, 'utf8'));
  const [meta, tokenizerJson, tokenizerConfig] = await Promise.all([json('watersheep.json'), json('tokenizer/tokenizer.json'), json('tokenizer/tokenizer_config.json')]);
  const session = await ort.InferenceSession.create(`${directory}/onnx/model_quantized.onnx`, { graphOptimizationLevel: 'all' });
  return waterSheepFromFiles({ ort, Tokenizer, session, meta, tokenizerJson, tokenizerConfig });
}
