import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import test from 'node:test';
import {
  MAX_WAVEFORM_BYTES, NormalizedWavPeaks, Pcm16PeakReducer,
  type WaveformWorkerReply,
} from '../src/waveform.ts';

function bytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function tag(value: string): Uint8Array { return Uint8Array.from(value, char => char.charCodeAt(0)); }

function chunk(id: string, payload: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  head.set(tag(id));
  new DataView(head.buffer).setUint32(4, payload.length, true);
  return bytes(head, payload, new Uint8Array(payload.length % 2));
}

function format(extended = false): Uint8Array {
  const data = new Uint8Array(extended ? 18 : 16);
  const view = new DataView(data.buffer);
  view.setUint16(0, 1, true); view.setUint16(2, 2, true);
  view.setUint32(4, 44100, true); view.setUint32(8, 176400, true);
  view.setUint16(12, 4, true); view.setUint16(14, 16, true);
  return data;
}

function container(...parts: Uint8Array[]): Uint8Array {
  const payload = bytes(...parts), head = new Uint8Array(12);
  head.set(tag('RIFF')); head.set(tag('WAVE'), 8);
  new DataView(head.buffer).setUint32(4, payload.length + 4, true);
  return bytes(head, payload);
}

function pcm(count: number, value: (frame: number) => [number, number]): Uint8Array {
  const result = new Uint8Array(count * 4), view = new DataView(result.buffer);
  for (let frame = 0; frame < count; frame++) {
    const [left, right] = value(frame);
    view.setInt16(frame * 4, left, true); view.setInt16(frame * 4 + 2, right, true);
  }
  return result;
}

function wav(data: Uint8Array = new Uint8Array(44100 * 4)): Uint8Array {
  return container(chunk('fmt ', format()), chunk('data', data));
}

function feed(parser: { push(value: Uint8Array): void }, input: Uint8Array, size: number): void {
  for (let position = 0; position < input.length; position += size) parser.push(input.subarray(position, position + size));
}

test('PCM bins preserve signed extrema from both channels at exact441-frame boundaries', () => {
  const parser = new Pcm16PeakReducer(442);
  parser.push(pcm(442, i => i === 440 ? [32767, -32768] : i === 441 ? [17, 99] : [20, 30]));
  assert.equal(parser.framesRead, 442);
  assert.equal(parser.totalFrames, 442);
  const peaks = parser.finish();
  assert.deepEqual([...peaks.minima], [-32768, 17]);
  assert.deepEqual([...peaks.maxima], [32767, 99]);
  assert.equal(peaks.sampleRate, 44100);
  assert.equal(peaks.binFrames, 441);
});

test('silence, positive-only, negative-only and opposite phase never acquire invented zero extrema', () => {
  for (const [left, right] of [[0, 0], [123, 456], [-456, -123], [-30000, 30000]]) {
    const parser = new Pcm16PeakReducer(441);
    parser.push(pcm(441, () => [left, right]));
    const peaks = parser.finish();
    assert.deepEqual([...peaks.minima], [Math.min(left, right)]);
    assert.deepEqual([...peaks.maxima], [Math.max(left, right)]);
  }
});

test('PCM handles every small byte split, including half samples and incomplete stereo frames', () => {
  const data = pcm(883, i => [i % 2 ? -100 : 200, i === 882 ? -32768 : 50]);
  for (let split = 1; split <= 7; split++) {
    const parser = new Pcm16PeakReducer(883);
    parser.push(data.subarray(0, 3));
    assert.equal(parser.framesRead, 0);
    feed(parser, data.subarray(3), split);
    assert.deepEqual([...parser.finish().minima], [-100, -100, -32768]);
  }
});

test('PCM rejects invalid counts, overrun, truncated input and post-finish writes', () => {
  for (const n of [0, -1, .5, NaN, 13230001]) assert.throws(() => new Pcm16PeakReducer(n));
  const partial = new Pcm16PeakReducer(2);
  partial.push(new Uint8Array(7));
  assert.throws(() => partial.finish(), /truncat|complete|length/i);
  const extra = new Pcm16PeakReducer(1);
  assert.throws(() => extra.push(new Uint8Array(5)), /length|exceed|extra/i);
  assert.throws(() => extra.finish());
  const done = new Pcm16PeakReducer(1);
  done.push(new Uint8Array(4)); done.finish();
  assert.throws(() => done.push(new Uint8Array(0)), /finish|closed|complete/i);
});

test('normalized parser exposes authoritative frame progress and keeps a one-frame final bin', () => {
  const data = pcm(44101, i => i === 44100 ? [-12345, 23456] : [12, 34]);
  const input = wav(data), parser = new NormalizedWavPeaks(44101 / 44100);
  assert.equal(parser.totalFrames, 0);
  parser.push(input.subarray(0, 44));
  assert.equal(parser.totalFrames, 44101);
  assert.equal(parser.framesRead, 0);
  parser.push(input.subarray(44, 47));
  assert.equal(parser.framesRead, 0);
  parser.push(input.subarray(47));
  const peaks = parser.finish();
  assert.equal(peaks.frameCount, 44101);
  assert.equal(peaks.minima.length, 101);
  assert.equal(peaks.minima[100], -12345);
  assert.equal(peaks.maxima[100], 23456);
  assert.equal(parser.framesRead, parser.totalFrames);
});

test('RIFF parsing accepts arbitrary splits, unknown chunks, odd padding and fmt18 zero extension', () => {
  const input = container(chunk('JUNK', Uint8Array.of(1, 2, 3)), chunk('fmt ', format(true)),
    chunk('LIST', Uint8Array.of(8)), chunk('data', pcm(44100, () => [500, -700])), chunk('NOTE', Uint8Array.of(9)));
  for (const split of [1, 2, 3, 7, 65536]) {
    const parser = new NormalizedWavPeaks(1);
    feed(parser, input, split);
    const peaks = parser.finish();
    assert.equal(peaks.minima.length, 100);
    assert.ok(peaks.minima.every(value => value === -700));
    assert.ok(peaks.maxima.every(value => value === 500));
  }
});

test('normalized parser enforces one-sample duration tolerance, not compressed metadata allowance', () => {
  for (const expected of [1, 1 + .75 / 44100, 1 + 1 / 44100]) {
    const parser = new NormalizedWavPeaks(expected);
    parser.push(wav()); parser.finish();
  }
  for (const expected of [1 + 1.01 / 44100, 1.1]) {
    const parser = new NormalizedWavPeaks(expected);
    assert.throws(() => parser.push(wav()), /duration|match/i);
  }
  for (const expected of [0, 300.1, NaN, Infinity]) assert.throws(() => new NormalizedWavPeaks(expected));
});

test('rejects unsupported PCM fields and nonzero format extension', () => {
  for (const [offset, size, value] of [[0, 2, 3], [2, 2, 1], [4, 4, 48000], [8, 4, 176401], [12, 2, 2], [14, 2, 32], [16, 2, 1]]) {
    const fmt = format(true), view = new DataView(fmt.buffer);
    if (size === 2) view.setUint16(offset, value, true); else view.setUint32(offset, value, true);
    assert.throws(() => new NormalizedWavPeaks(1).push(container(chunk('fmt ', fmt), chunk('data', new Uint8Array(176400)))), /format|PCM|44/i);
  }
});

test('rejects missing, duplicate and out-of-order fmt/data chunks and unaligned samples', () => {
  const fmt = chunk('fmt ', format()), data = chunk('data', new Uint8Array(176400));
  for (const input of [container(data, fmt), container(fmt, fmt, data), container(fmt, data, data),
    container(fmt, chunk('data', new Uint8Array(176401)))]) {
    const parser = new NormalizedWavPeaks(1);
    assert.throws(() => { parser.push(input); parser.finish(); });
  }
  for (const input of [container(fmt), container(chunk('JUNK', Uint8Array.of(1)))]) {
    const parser = new NormalizedWavPeaks(1);
    parser.push(input);
    assert.throws(() => parser.finish(), /missing|format|data|incomplete/i);
  }
});

test('RIFF rejects wrong signatures, declared crossings, missing padding, truncation and trailing bytes', () => {
  const original = wav();
  const invalid: Uint8Array[] = [];
  for (const signature of ['RIFX', 'RF64', 'junk']) {
    const changed = original.slice(); changed.set(tag(signature)); invalid.push(changed);
  }
  const wrongForm = original.slice(); wrongForm.set(tag('AVI '), 8); invalid.push(wrongForm);
  const crossing = original.slice(); new DataView(crossing.buffer).setUint32(40, 176404, true); invalid.push(crossing);
  const missingPad = container(chunk('fmt ', format()), chunk('data', new Uint8Array(176400)), tag('JUNK'), Uint8Array.of(1, 0, 0, 0, 9));
  invalid.push(missingPad, original.subarray(0, original.length - 1), bytes(original, Uint8Array.of(0)));
  for (const input of invalid) {
    assert.throws(() => { const parser = new NormalizedWavPeaks(1); parser.push(input); parser.finish(); });
  }
});

test('4KiB non-data overhead is accepted exactly and larger metadata fails before data reduction', () => {
  const exact = container(chunk('fmt ', format()), chunk('JUNK', new Uint8Array(4044)), chunk('data', new Uint8Array(176400)));
  const parser = new NormalizedWavPeaks(1); parser.push(exact); parser.finish();
  assert.equal(exact.length - 176400, 4096);
  const excessive = container(chunk('fmt ', format()), chunk('JUNK', new Uint8Array(4045)), chunk('data', new Uint8Array(176400)));
  assert.throws(() => new NormalizedWavPeaks(1).push(excessive), /overhead|metadata|limit/i);
});

test('failed parser cannot later publish a partial result', () => {
  const parser = new NormalizedWavPeaks(1);
  assert.throws(() => parser.push(new Uint8Array(12)));
  assert.throws(() => parser.push(wav()));
  assert.throws(() => parser.finish());
});

test('300-second source streams into only30,000 Int16 extrema pairs', () => {
  const header = wav().subarray(0, 44).slice();
  new DataView(header.buffer).setUint32(4, 52920036, true);
  new DataView(header.buffer).setUint32(40, 52920000, true);
  const parser = new NormalizedWavPeaks(300);
  parser.push(header);
  const block = new Uint8Array(65536);
  for (let remaining = 52920000; remaining > 0; remaining -= Math.min(remaining, block.length)) {
    parser.push(block.subarray(0, Math.min(remaining, block.length)));
  }
  const peaks = parser.finish();
  assert.equal(peaks.frameCount, 13230000);
  assert.equal(peaks.minima.length, 30000);
  assert.equal(peaks.minima.byteLength + peaks.maxima.byteLength, 120000);
  assert.ok(peaks.minima.every(value => value === 0));
  const tooLong = header.slice(); new DataView(tooLong.buffer).setUint32(4, 52920040, true);
  new DataView(tooLong.buffer).setUint32(40, 52920004, true);
  assert.throws(() => new NormalizedWavPeaks(300).push(tooLong), /frame|duration|300|limit/i);
});

async function workerRun(response: (res: ServerResponse) => void, request: unknown = { projectId: 'a'.repeat(32), duration: 1 }, expire = false) {
  const urls: string[] = [];
  const server = createServer((req, res) => { urls.push(req.url!); response(res); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const messages: WaveformWorkerReply[] = [];
  const transferSizes: number[][] = [];
  const script = `const {parentPort,workerData}=require('node:worker_threads');
    const originalFetch=fetch; globalThis.fetch=(path,init)=>originalFetch(new URL(path,workerData.origin),init);
    Response.prototype.arrayBuffer=Response.prototype.blob=()=>{throw Error('Whole response read forbidden');};
    if(workerData.expire){let calls=0;globalThis.performance={now:()=>++calls<3?0:31000};}
    globalThis.self={postMessage:(message,options)=>parentPort.postMessage({message,sizes:(options?.transfer??[]).map(b=>b.byteLength)},options?.transfer),close:()=>parentPort.close()};
    import(workerData.module).then(()=>self.onmessage({data:workerData.request}));`;
  const worker = new Worker(script, { eval: true, workerData: {
    origin, request, expire, module: new URL('../src/waveform.worker.ts', import.meta.url).href,
  } });
  try {
    const final = await new Promise<WaveformWorkerReply>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker test deadline.')), 4000);
      worker.on('error', error => { clearTimeout(timeout); reject(error); });
      worker.on('message', packet => {
        messages.push(packet.message); transferSizes.push(packet.sizes);
        if (packet.message.type !== 'progress') { clearTimeout(timeout); resolve(packet.message); }
      });
    });
    return { final, urls, messages, transferSizes };
  } finally {
    await worker.terminate();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test('real worker fetches only generated original-audio route and transfers small exact peaks', async () => {
  const input = wav(pcm(44100, i => i === 440 ? [-32768, 32767] : [100, 200]));
  const result = await workerRun(res => { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': input.length }); res.end(input); });
  assert.equal(result.final.type, 'ready');
  assert.deepEqual(result.urls, [`/api/projects/${'a'.repeat(32)}/audio/original`]);
  if (result.final.type !== 'ready') return;
  assert.equal(result.final.peaks.minima[0], -32768);
  assert.equal(result.final.peaks.maxima[0], 32767);
  assert.deepEqual(result.transferSizes.at(-1), [200, 200]);
});

test('worker rejects malformed request before fetch and never echoes HTTP response bodies', async () => {
  const invalid = await workerRun(res => res.end('never'), { projectId: '../outside', duration: 1 });
  assert.equal(invalid.final.type, 'error'); assert.deepEqual(invalid.urls, []);
  const failure = await workerRun(res => { res.writeHead(404); res.end('secret response body'); });
  assert.equal(failure.final.type, 'error');
  if (failure.final.type === 'error') assert.ok(!failure.final.message.includes('secret'));
});

test('worker rejects oversized declarations and deadline expiry without reading a full response', async () => {
  const excessive = await workerRun(res => { res.writeHead(200, { 'Content-Length': MAX_WAVEFORM_BYTES + 1 }); res.end(); });
  assert.equal(excessive.final.type, 'error');
  const expired = await workerRun(res => res.end(wav()), undefined, true);
  assert.equal(expired.final.type, 'error');
  if (expired.final.type === 'error') assert.match(expired.final.message, /time|deadline|retry/i);
});
