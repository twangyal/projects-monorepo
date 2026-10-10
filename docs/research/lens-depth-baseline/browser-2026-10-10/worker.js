/* Actual-runtime research test worker. No product model integration. */
importScripts('/ort/ort.wasm.min.js');
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL('/ort/', self.location.href).href;
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
async function checked(url, sha) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed: ${url}`);
  const bytes = await response.arrayBuffer();
  if (await hash(bytes) !== sha) throw new Error(`Checksum mismatch: ${url}`);
  return bytes;
}
self.onmessage = async ({data: config}) => {
  let session;
  try {
    const model = await checked('/model', config.modelSha);
    const input = new Float32Array(await checked('/input', config.inputSha));
    const cpu = new Float32Array(await checked('/cpu', config.cpuSha));
    const began = performance.now();
    session = await ort.InferenceSession.create(new Uint8Array(model), {executionProviders: ['wasm']});
    const sessionLoadMs = performance.now() - began;
    if (session.inputNames.join() !== 'pixel_values' || session.outputNames.join() !== 'predicted_depth') throw new Error('Unexpected model interface');
    const tensor = new ort.Tensor('float32', input, [1, 3, 518, 784]);
    const runs = [];
    for (let round = 0; round < 2; round++) {
      self.postMessage({stage: 'running', round});
      const start = performance.now();
      const raw = (await session.run({pixel_values: tensor})).predicted_depth;
      const inferenceMs = performance.now() - start;
      if (raw.type !== 'float32' || raw.dims.join() !== '1,518,784' || raw.data.length !== cpu.length) throw new Error('Unexpected output');
      let min = Infinity, max = -Infinity, maxAbsCpuDifference = 0, sumAbsCpuDifference = 0;
      for (let i = 0; i < raw.data.length; i++) {
        const value = raw.data[i];
        if (!Number.isFinite(value) || !Number.isFinite(cpu[i])) throw new Error('Nonfinite depth');
        min = Math.min(min, value); max = Math.max(max, value);
        const difference = Math.abs(value - cpu[i]);
        maxAbsCpuDifference = Math.max(maxAbsCpuDifference, difference); sumAbsCpuDifference += difference;
      }
      if (!(max > min)) throw new Error('Constant depth output');
      function sample(point) {
        const x = Math.floor(point[0] * 784), y = Math.floor(point[1] * 518), values = [];
        for (let j = Math.max(0, y - 1); j < Math.min(518, y + 2); j++) for (let i = Math.max(0, x - 1); i < Math.min(784, x + 2); i++) values.push(raw.data[j * 784 + i]);
        values.sort((a, b) => a - b);
        return values.length % 2 ? values[Math.floor(values.length / 2)] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
      }
      const pairs = config.pairs.map(pair => {const nearRaw = sample(pair.near), farRaw = sample(pair.far); return {...pair, nearRaw, farRaw, correct: nearRaw > farRaw};});
      const bytes = new Uint8Array(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength);
      runs.push({inferenceMs, startedEpochMs: performance.timeOrigin + start, finishedEpochMs: performance.timeOrigin + start + inferenceMs, shape: raw.dims, type: raw.type, rawSha256: await hash(bytes), rawRange: [min, max], maxAbsCpuDifference, meanAbsCpuDifference: sumAbsCpuDifference / cpu.length, pairs});
      raw.dispose();
    }
    tensor.dispose();
    await session.release(); session = undefined;
    self.postMessage({done: true, sessionLoadMs, runs, ortVersions: ort.env.versions, configuredThreads: ort.env.wasm.numThreads, crossOriginIsolated: self.crossOriginIsolated});
  } catch (error) {
    if (session) await session.release();
    self.postMessage({error: String(error)});
  }
};
