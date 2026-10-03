import assert from 'node:assert/strict';
import test from 'node:test';
import { MelodyRecorder, type RecorderDevice, type RecorderDependencies } from '../src/recorder.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class FakeRecorder implements RecorderDevice {
  state: RecordingState = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: RecorderDevice['ondataavailable'] = null;
  onstop: RecorderDevice['onstop'] = null;
  onerror: RecorderDevice['onerror'] = null;
  stopError: Error | null = null;
  startError: Error | null = null;
  start() {
    if (this.startError) throw this.startError;
    this.state = 'recording';
  }
  stop() {
    if (this.stopError) throw this.stopError;
    this.state = 'inactive';
  }
  data(value: string) { this.ondataavailable?.({ data: new Blob([value]) } as BlobEvent); }
  finish() { this.onstop?.(new Event('stop')); }
  fail(error: Error) { this.onerror?.(Object.assign(new Event('error'), { error }) as ErrorEvent); }
}

function harness() {
  const permission = deferred<MediaStream>();
  const device = new FakeRecorder();
  let stoppedTracks = 0;
  let permissionCalls = 0;
  let timer: (() => void) | null = null;
  let timerDelay = 0;
  const stream = {
    getTracks: () => [{ stop: () => { stoppedTracks += 1; } }, { stop: () => { stoppedTracks += 1; } }],
  } as unknown as MediaStream;
  const dependencies: RecorderDependencies = {
    getUserMedia: () => { permissionCalls += 1; return permission.promise; },
    createMediaRecorder: () => device,
    setTimeout: (callback, delay) => { timer = callback; timerDelay = delay; return 1; },
    clearTimeout: () => { timer = null; },
  };
  const recorder = new MelodyRecorder(dependencies);
  return {
    recorder, permission, stream, device, dependencies,
    stopped: () => stoppedTracks,
    requests: () => permissionCalls,
    timerDelay: () => timerDelay,
    hasTimer: () => timer !== null,
    hitLimit: () => { assert.ok(timer); timer(); },
    async start(onLimit: (blob: Blob) => void = () => {}, onError?: (error: Error) => void) {
      const pending = recorder.start(onLimit, onError);
      assert.equal(recorder.state, 'requesting');
      permission.resolve(stream);
      await pending;
    },
  };
}

test('normal stop returns all recorded chunks and immediately releases every microphone track', async () => {
  const h = harness();
  await h.start();
  assert.equal(h.recorder.state, 'recording');
  h.device.data('melody');
  const stopping = h.recorder.stop();
  assert.equal(h.recorder.state, 'stopping');
  assert.equal(h.stopped(), 2);
  assert.equal(h.hasTimer(), false);
  const secondStop = h.recorder.stop();
  h.device.data(' end');
  h.device.finish();
  const blob = await stopping;
  assert.ok(blob);
  assert.equal(blob.type, 'audio/webm');
  assert.equal(await blob.text(), 'melody end');
  assert.equal(await secondStop, blob);
  assert.equal(h.recorder.state, 'idle');
  assert.equal(await h.recorder.stop(), null);
});

test('permission denial rejects start and resets the recorder for another attempt', async () => {
  const h = harness();
  const denial = new Error('Microphone denied');
  const pending = h.recorder.start(() => {});
  h.permission.reject(denial);
  await assert.rejects(pending, denial);
  assert.equal(h.recorder.state, 'idle');
  assert.equal(h.stopped(), 0);
});

test('cancelling pending permission releases a stream that arrives later without recording', async () => {
  const h = harness();
  const pending = h.recorder.start(() => { assert.fail('Cancelled recording delivered'); });
  h.recorder.cancel();
  assert.equal(h.recorder.state, 'idle');
  h.permission.resolve(h.stream);
  await pending;
  assert.equal(h.stopped(), 2);
  assert.equal(h.device.state, 'inactive');
  assert.equal(h.hasTimer(), false);
});

test('cancel discards captured audio and settles a pending stop without delivering it', async () => {
  const h = harness();
  await h.start(() => { assert.fail('Cancelled recording delivered'); });
  h.device.data('private audio');
  const pending = h.recorder.stop();
  h.recorder.cancel();
  h.device.finish();
  assert.equal(await pending, null);
  assert.equal(h.recorder.state, 'idle');
  assert.equal(h.stopped(), 2);
});

test('the twenty-second cap stops recording and delivers one complete audio blob', async () => {
  const h = harness();
  const delivered: Blob[] = [];
  await h.start(blob => { delivered.push(blob); });
  assert.equal(h.timerDelay(), 20_000);
  h.device.data('capped');
  h.hitLimit();
  assert.equal(h.recorder.state, 'stopping');
  assert.equal(h.stopped(), 2);
  h.device.finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(delivered.length, 1);
  assert.equal(await delivered[0]?.text(), 'capped');
  assert.equal(h.recorder.state, 'idle');
});

test('cancelling after the cap fires prevents deferred delivery', async () => {
  const h = harness();
  await h.start(() => { assert.fail('Cancelled cap delivered'); });
  h.hitLimit();
  h.device.finish();
  h.recorder.cancel();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.recorder.state, 'idle');
});

test('a synchronous recorder start failure rejects and releases the stream', async () => {
  const h = harness();
  h.device.startError = new Error('Recording unsupported');
  await assert.rejects(h.start(), h.device.startError);
  assert.equal(h.stopped(), 2);
  assert.equal(h.recorder.state, 'idle');
});

test('a recorder event failure rejects stop and releases resources', async () => {
  const h = harness();
  await h.start();
  const failure = new Error('Recorder crashed');
  h.device.fail(failure);
  assert.equal(h.stopped(), 2);
  assert.equal(h.recorder.state, 'idle');
  await assert.rejects(h.recorder.stop(), failure);
  assert.equal(h.hasTimer(), false);
});

test('a stop failure rejects the caller and releases resources', async () => {
  const h = harness();
  await h.start();
  h.device.stopError = new Error('Stop failed');
  await assert.rejects(h.recorder.stop(), h.device.stopError);
  assert.equal(h.stopped(), 2);
  assert.equal(h.recorder.state, 'idle');
});

test('concurrent starts reject without issuing a second permission request', async () => {
  const h = harness();
  const pending = h.recorder.start(() => {});
  await assert.rejects(h.recorder.start(() => {}), /already|progress/i);
  assert.equal(h.requests(), 1);
  h.permission.resolve(h.stream);
  await pending;
  await assert.rejects(h.recorder.start(() => {}), /already|progress/i);
  h.recorder.cancel();
});

test('a cancelled permission generation cannot reset a newer active recording', async () => {
  const h = harness();
  const newer = deferred<MediaStream>();
  let calls = 0;
  const recorder = new MelodyRecorder({
    ...h.dependencies,
    getUserMedia: () => (++calls === 1 ? h.permission.promise : newer.promise),
  });
  const olderStart = recorder.start(() => {});
  recorder.cancel();
  const newerStart = recorder.start(() => {});
  newer.resolve(h.stream);
  await newerStart;
  h.permission.resolve(h.stream);
  await olderStart;
  assert.equal(recorder.state, 'recording');
  assert.equal(h.stopped(), 2);
  recorder.cancel();
  assert.equal(h.stopped(), 4);
});

test('a denial after cancellation is consumed without changing the next recording', async () => {
  const h = harness();
  const pending = h.recorder.start(() => {});
  h.recorder.cancel();
  h.permission.reject(new Error('Cancelled request denied'));
  await pending;
  assert.equal(h.recorder.state, 'idle');
});

test('cancel during active recording releases tracks and ignores later data and stop events', async () => {
  const h = harness();
  await h.start(() => { assert.fail('Cancelled audio delivered'); });
  h.device.data('discard this');
  h.recorder.cancel();
  assert.equal(h.device.state, 'inactive');
  assert.equal(h.stopped(), 2);
  assert.equal(h.hasTimer(), false);
  h.device.data('late data');
  h.device.finish();
  assert.equal(await h.recorder.stop(), null);
});

test('stop while requesting permission cancels the request and releases a late stream', async () => {
  const h = harness();
  const pending = h.recorder.start(() => {});
  assert.equal(await h.recorder.stop(), null);
  assert.equal(h.recorder.state, 'idle');
  h.permission.resolve(h.stream);
  await pending;
  assert.equal(h.stopped(), 2);
});

test('a recorder construction failure releases the permission stream', async () => {
  const h = harness();
  const failure = new Error('Recorder construction failed');
  const recorder = new MelodyRecorder({
    ...h.dependencies,
    createMediaRecorder: () => { throw failure; },
  });
  const pending = recorder.start(() => {});
  h.permission.resolve(h.stream);
  await assert.rejects(pending, failure);
  assert.equal(recorder.state, 'idle');
  assert.equal(h.stopped(), 2);
});

test('a cap stop failure is handled internally and remains available to the next stop caller', async () => {
  const h = harness();
  await h.start(() => { assert.fail('Failed recorder delivered audio'); });
  const failure = new Error('Cap stop failed');
  h.device.stopError = failure;
  h.hitLimit();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.recorder.state, 'idle');
  assert.equal(h.stopped(), 2);
  await assert.rejects(h.recorder.stop(), failure);
});

test('a cap callback exception cannot create an unhandled asynchronous rejection', async () => {
  const h = harness();
  await h.start(() => { throw new Error('Consumer callback failed'); });
  h.hitLimit();
  h.device.finish();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(h.recorder.state, 'idle');
  assert.equal(h.stopped(), 2);
});

test('a post-start recorder failure notifies the error callback once and preserves stop rejection', async () => {
  const h = harness();
  const errors: Error[] = [];
  const failure = new Error('Recording device disconnected');
  await h.start(() => { assert.fail('Failed audio delivered'); }, error => { errors.push(error); });
  h.device.fail(failure);
  h.device.fail(new Error('Duplicate error event'));
  h.device.finish();
  await Promise.resolve();
  assert.deepEqual(errors, [failure]);
  assert.equal(h.stopped(), 2);
  assert.equal(h.recorder.state, 'idle');
  await assert.rejects(h.recorder.stop(), failure);
});

test('a cap stop failure notifies the optional error callback without delivering audio', async () => {
  const h = harness();
  const errors: Error[] = [];
  await h.start(() => { assert.fail('Failed cap audio delivered'); }, error => { errors.push(error); });
  const failure = new Error('Automatic stop failed');
  h.device.stopError = failure;
  h.hitLimit();
  await Promise.resolve();
  assert.deepEqual(errors, [failure]);
  assert.equal(h.stopped(), 2);
  assert.equal(h.recorder.state, 'idle');
});

test('cancel suppresses an error notification that has not yet been delivered', async () => {
  const h = harness();
  await h.start(() => {}, () => { assert.fail('Cancelled error delivered'); });
  h.device.fail(new Error('Cancelled failure'));
  h.recorder.cancel();
  await Promise.resolve();
  assert.equal(await h.recorder.stop(), null);
});

test('a newer recording suppresses an old generation error notification', async () => {
  const h = harness();
  await h.start(() => {}, () => { assert.fail('Stale error delivered'); });
  h.device.fail(new Error('Old generation failure'));
  await h.recorder.start(() => {});
  assert.equal(h.recorder.state, 'recording');
  h.recorder.cancel();
});

test('synchronous start failures reject start without calling the asynchronous error callback', async () => {
  const h = harness();
  h.device.startError = new Error('Immediate recording failure');
  await assert.rejects(h.start(() => {}, () => { assert.fail('Start error notified twice'); }), h.device.startError);
  await Promise.resolve();
  assert.equal(h.stopped(), 2);
});

test('an error callback exception is handled without an unhandled rejection', async () => {
  const h = harness();
  let delivered = 0;
  await h.start(() => {}, () => { delivered += 1; throw new Error('Error consumer failed'); });
  h.device.fail(new Error('Device failure'));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(delivered, 1);
  assert.equal(h.recorder.state, 'idle');
});
