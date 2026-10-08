import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/model.ts';
import { parseHeartRate, type CalibrationResult, type HeartRateNotification } from '../src/heart-rate.ts';

const idle = { x: 0, y: 0, interact: false, steady: false };
function calibration(): CalibrationResult {
  return { connectionId: 7, startedAtMs: 100, completedAtMs: 4100, baseline: 70,
    samples: [68, 70, 72, 70, 70].map((bpm, i) => ({ bpm, sequence: i + 1, receivedAtMs: 100 + i * 1000 })) };
}
function bluetooth() {
  return game.newRun(70, false, { source: 'bluetooth-hr', calibration: calibration(), startedAtMs: 4500 });
}
function notification(sequence = 6, receivedAtMs = 4501, bpm = 140,
  contact: HeartRateNotification['measurement']['contact'] = 'detected'): HeartRateNotification {
  return { connectionId: 7, sequence, receivedAtMs,
    measurement: { bpm, contact, energyPresent: false, rrCount: 0 } };
}

test('Bluetooth origin is detached and runtime immutable without freezing gameplay', () => {
  const original = calibration();
  const run = game.newRun(70, false, { source: 'bluetooth-hr', calibration: original, startedAtMs: 4500 });
  assert.equal(run.source, 'bluetooth-hr');
  assert.equal(run.sensor, 'missing');
  assert.deepEqual(run.samples, []);
  original.samples[0]!.bpm = 99;
  assert.equal(run.calibration!.samples[0]!.bpm, 68);
  assert.equal(Reflect.set(run, 'source', 'simulated'), false);
  assert.equal(Reflect.set(run, 'baseline', 99), false);
  assert.equal(Reflect.set(run, 'calibration', null), false);
  assert.throws(() => Object.defineProperty(run, 'source', { value: 'simulated' }));
  assert(Object.isFrozen(run.calibration));
  assert(Object.isFrozen(run.calibration!.samples));
  assert(Object.isFrozen(run.calibration!.samples[0]));
  assert.equal(Reflect.set(run.calibration!.samples[0]!, 'bpm', 99), false);
  run.x = 500;
  assert.equal(run.x, 500);
});

test('Bluetooth construction revalidates calibration shape, bounds, spacing, mean and age', () => {
  const alterations: Array<(value: CalibrationResult) => void> = [
    value => { delete value.samples[2]; },
    value => { value.samples.pop(); },
    value => { value.samples[2]!.bpm = 70.5; },
    value => { value.samples[0]!.bpm = 39; },
    value => { value.samples[0]!.bpm = 50; value.baseline = 66.4; },
    value => { value.samples[1]!.receivedAtMs = 1099; },
    value => { value.samples[1]!.sequence = 1; },
    value => { value.samples[4]!.receivedAtMs = 30101; value.completedAtMs = 30101; },
    value => { value.completedAtMs = 4099; },
    value => { value.startedAtMs = -1; },
    value => { value.connectionId = 0; },
    value => { value.baseline = 71; },
  ];
  for (const alter of alterations) {
    const value = calibration(); alter(value);
    assert.throws(() => game.newRun(value.baseline, false, { source: 'bluetooth-hr', calibration: value, startedAtMs: 4500 }));
  }
  for (const startedAtMs of [NaN, Infinity, -1, 4099, 14100.001]) {
    assert.throws(() => game.newRun(70, false, { source: 'bluetooth-hr', calibration: calibration(), startedAtMs }));
  }
  assert.equal(game.newRun(70, false, { source: 'bluetooth-hr', calibration: calibration(), startedAtMs: 14100 }).baseline, 70);
  assert.throws(() => game.newRun(71, false, { source: 'bluetooth-hr', calibration: calibration(), startedAtMs: 4500 }));
});

test('simulator source and schema1 report remain compatible and refuse Bluetooth injection', () => {
  const run = game.newRun(70, false);
  assert.equal(run.source, 'simulated'); assert.equal(run.calibration, null);
  assert.equal(game.sampleBluetooth(run, notification()), false);
  assert.equal(game.sample(run, 140), true);
  game.pause(run); game.resume(run); game.advance(run, .25, idle);
  assert.equal(run.sensor, 'fresh');
  assert.deepEqual(Object.keys(game.runReport(run)), ['schemaVersion', 'source', 'scenario', 'baselineBpm', 'scares', 'outcome', 'loss', 'activeSeconds', 'objectives', 'samples', 'events', 'truncatedSamples', 'truncatedEvents', 'limitations']);
  assert.equal(game.runReport(run).schemaVersion, 1);
  assert.deepEqual(game.runReport(run).samples, [{ time: 0, bpm: 140 }]);
  assert.equal(game.runReport(run).limitations, 'Declared simulated game inputs only; not measured physiology, emotion inference, medical information or a deterministic replay file.');
});

test('Bluetooth has no initial game reading and refuses simulator injection', () => {
  const run = bluetooth(), before = JSON.stringify(run);
  assert.equal(game.sample(run, 220), false);
  assert.equal(JSON.stringify(run), before);
  game.advance(run, .25, idle, 4500);
  assert.equal(run.sensor, 'missing'); assert.equal(run.tension, 0);
  assert.equal(game.sampleBluetooth(run, notification()), true);
  assert.deepEqual(run.samples, [{ time: run.time, bpm: 140, receivedSeconds: 4.401 }]);
});

test('source connection, final calibration sequence and strict run-start receipt are pinned', () => {
  const run = bluetooth();
  assert.equal(game.sampleBluetooth(run, { ...notification(), connectionId: 8, receivedAtMs: NaN }), false);
  assert.equal(game.sampleBluetooth(run, notification(5, NaN)), false);
  assert.equal(game.sampleBluetooth(run, notification(6, 4500)), false);
  assert.equal(game.sampleBluetooth(run, notification(6, 4501)), false); // Consumed structural sequence.
  assert.equal(game.sampleBluetooth(run, notification(7, 4501)), true);
  assert.equal(run.samples.length, 1);
});

test('bursts and ineligible BPM consume sequence without changing the usable sample', () => {
  const run = bluetooth();
  assert.equal(game.sampleBluetooth(run, notification(6, 5000)), true);
  assert.equal(game.sampleBluetooth(run, notification(7, 5500, 180)), false);
  assert.equal(game.sampleBluetooth(run, notification(7, 6000, 180)), false);
  assert.equal(game.sampleBluetooth(run, notification(8, 6000, 221)), false);
  assert.equal(game.sampleBluetooth(run, notification(8, 7000, 180)), false);
  assert.equal(game.sampleBluetooth(run, notification(9, 7000, 180)), true);
  assert.deepEqual(run.samples.map(value => value.bpm), [140, 180]);
});

test('contact loss bypasses burst and BPM admission and immediately clears only usable state', () => {
  const run = bluetooth(); game.sampleBluetooth(run, notification(6, 5000));
  const history = JSON.stringify(run.samples);
  assert.equal(game.sampleBluetooth(run, notification(7, 5001, 0, 'not-detected')), false);
  assert.equal(run.sensor, 'missing'); assert.equal(JSON.stringify(run.samples), history);
  game.advance(run, .25, idle, 5001);
  assert.equal(run.tension, 0);
  assert.equal(game.sampleBluetooth(run, notification(8, 6000)), true);
});

test('receipt clock freshness is exact even when active time is stalled or capped', () => {
  const run = bluetooth(); game.sampleBluetooth(run, notification(6, 4501));
  game.advance(run, .25, idle, 14501);
  assert.equal(run.sensor, 'fresh'); assert(run.tension > 0);
  const tension = run.tension;
  game.advance(run, .25, idle, 14501.0001);
  assert.equal(run.sensor, 'stale'); assert(run.tension < tension);
  assert(run.time < .51);
  game.advance(run, 100, idle, 30000);
  assert.equal(run.sensor, 'stale'); assert(run.time < .76);
});

test('a zero-elapsed frame still exposes exact receipt-time staleness', () => {
  const run = bluetooth(); game.sampleBluetooth(run, notification());
  game.advance(run, 0, idle, 14501);
  assert.equal(run.sensor, 'fresh');
  game.advance(run, 0, idle, 14501.001);
  assert.equal(run.sensor, 'stale');
  assert.equal(run.time, 0); assert.equal(run.remainder, 0);
});

test('a maximum legal RR tail remains ignored metadata rather than rejecting the game input', () => {
  const run = bluetooth(), value = notification();
  const packet = new Uint8Array(512);
  packet[0] = 0x10; packet[1] = 140;
  value.measurement = parseHeartRate(packet); // 2-byte base + 255 intervals = 512 bytes.
  assert.equal(value.measurement.rrCount, 255);
  assert.equal(game.sampleBluetooth(run, value), true);
  assert.deepEqual(run.samples, [{ time: 0, bpm: 140, receivedSeconds: 4.401 }]);
});

test('disconnect and contact-loss transitions are recorded even before any game reading', () => {
  const run = bluetooth();
  game.invalidateBluetooth(run, 'disconnected');
  assert.equal(run.events.length, 2);
  assert.match(run.events.at(-1)!.text, /disconnected/);
  game.invalidateBluetooth(run, 'disconnected');
  assert.equal(run.events.length, 2); // Same unusable reason is not a new transition.
  game.invalidateBluetooth(run, 'hidden');
  assert.equal(run.events.length, 3);
  assert.equal(run.samples.length, 0);
  const contactRun = bluetooth();
  assert.equal(game.sampleBluetooth(contactRun, notification(6, 4501, 0, 'not-detected')), false);
  assert.equal(contactRun.events.length, 2);
  assert.match(contactRun.events.at(-1)!.text, /contact is not detected/);
  assert.equal(game.sampleBluetooth(contactRun, notification(7, 4502, 0, 'not-detected')), false);
  assert.equal(contactRun.events.length, 2);
  assert.equal(game.sampleBluetooth(contactRun, notification(8, 5501)), true);
  game.sampleBluetooth(contactRun, notification(9, 5502, 0, 'not-detected'));
  assert.equal(contactRun.events.length, 3);
});

test('a pause with no usable Bluetooth reading records the pause without a redundant signal event', () => {
  const run = bluetooth(); game.pause(run);
  assert.deepEqual(run.events.map(value => value.kind), ['start', 'pause']);
});

test('invalid clocks fail atomically before sub-step advance or resume and do not consume sequence', () => {
  const run = bluetooth(); game.sampleBluetooth(run, notification(6, 5000));
  game.advance(run, 0, idle, 6000);
  const before = JSON.stringify(run);
  for (const now of [undefined, NaN, Infinity, -1, 5999]) {
    assert.throws(() => game.advance(run, .001, idle, now));
    assert.equal(JSON.stringify(run), before);
  }
  assert.throws(() => game.sampleBluetooth(run, notification(7, 5999)));
  assert.equal(JSON.stringify(run), before);
  assert.equal(game.sampleBluetooth(run, notification(7, 6000)), true);
  game.pause(run);
  const paused = JSON.stringify(run);
  for (const now of [undefined, NaN, 5999]) {
    assert.throws(() => game.resume(run, now)); assert.equal(JSON.stringify(run), paused);
  }
  game.resume(run, 7000); assert.equal(run.phase, 'running');
});

test('pause/resume retains history but requires a strictly later new notification', () => {
  const run = bluetooth(); game.sampleBluetooth(run, notification(6, 5000));
  game.advance(run, .25, idle, 5000);
  const samples = JSON.stringify(run.samples);
  game.pause(run);
  assert.equal(run.sensor, 'missing');
  assert.equal(game.sampleBluetooth(run, notification(7, 8000)), false);
  game.advance(run, 100, idle, 10000);
  assert.equal(run.phase, 'paused'); assert.equal(JSON.stringify(run.samples), samples);
  game.resume(run, 12000);
  assert.equal(game.sampleBluetooth(run, notification(7, 12000)), false);
  assert.equal(game.sampleBluetooth(run, notification(8, 12001)), true);
  assert.equal(run.samples.length, 2);
  assert.equal(run.events.some(value => value.kind === 'pause'), true);
  assert.equal(run.events.some(value => value.kind === 'resume'), true);
});

test('all invalidation reasons retain samples and prevent the historical sample from returning', () => {
  for (const reason of ['disconnected', 'contact-lost', 'paused', 'hidden', 'invalid-clock'] as const) {
    const run = bluetooth(); game.sampleBluetooth(run, notification());
    const history = JSON.stringify(run.samples);
    game.invalidateBluetooth(run, reason);
    game.advance(run, .25, idle, 5000);
    assert.equal(run.sensor, 'missing'); assert.equal(run.tension, 0);
    assert.equal(JSON.stringify(run.samples), history);
  }
});

test('malformed measurements cannot refresh a Bluetooth reading or contaminate reports', () => {
  const run = bluetooth();
  for (const patch of [{ bpm: NaN }, { bpm: 140.5 }, { bpm: -1 }, { bpm: 65536 }, { contact: 'other' }, { rrCount: -1 }, { energyPresent: 'yes' }]) {
    const value = notification();
    value.measurement = { ...value.measurement, ...patch } as HeartRateNotification['measurement'];
    assert.equal(game.sampleBluetooth(run, value), false);
  }
  assert.deepEqual(run.samples, []);
  assert.equal(game.sampleBluetooth(run, notification()), true);
});

test('Bluetooth report has detached relative calibration/game receipts without transport identity', () => {
  const run = bluetooth(); game.sampleBluetooth(run, notification());
  const report = game.runReport(run);
  assert.equal(report.schemaVersion, 2); assert.equal(report.source, 'bluetooth-hr');
  assert('calibration' in report);
  assert.deepEqual(report.calibration, { baselineBpm: 70,
    samples: [{ bpm: 68, receivedSeconds: 0 }, { bpm: 70, receivedSeconds: 1 }, { bpm: 72, receivedSeconds: 2 }, { bpm: 70, receivedSeconds: 3 }, { bpm: 70, receivedSeconds: 4 }],
    spanSeconds: 4, runStartedSeconds: 4.4 });
  assert.deepEqual(report.samples, [{ time: 0, bpm: 140, receivedSeconds: 4.401 }]);
  const serialized = JSON.stringify(report);
  for (const privateKey of ['connectionId', 'sequence', 'receivedAtMs', 'startedAtMs', 'energyPresent', 'rrCount', 'device']) assert(!serialized.includes(JSON.stringify(privateKey) + ':'));
  assert.match(report.limitations, /unverified/);
  report.samples[0]!.bpm = 99;
  if (report.calibration) report.calibration.samples[0]!.bpm = 99;
  report.events[0]!.text = 'changed';
  assert.equal(run.samples[0]!.bpm, 140); assert.equal(run.calibration!.samples[0]!.bpm, 68);
  assert.notEqual(run.events[0]!.text, 'changed');
});

test('Bluetooth histories stay capped and terminal runs cannot accept more readings', () => {
  const run = bluetooth();
  for (let i = 0; i < 300; i++) assert.equal(game.sampleBluetooth(run, notification(6 + i, 5000 + i * 1000)), true);
  assert.equal(run.samples.length, 256); assert.equal(run.truncatedSamples, true);
  assert.equal(run.samples[0]!.receivedSeconds, 48.9);
  for (let i = 0; i < 140; i++) { game.pause(run); game.resume(run, 305000 + i); }
  assert.equal(run.events.length, 256); assert.equal(run.truncatedEvents, true);
  run.noise = 100; game.advance(run, .25, idle, 306000);
  const before = JSON.stringify(run);
  assert.equal(game.sampleBluetooth(run, notification(500, 307000)), false);
  assert.equal(JSON.stringify(run), before); assert.equal(run.events.at(-1)!.kind, 'loss');
});
