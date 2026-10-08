import test from 'node:test';
import assert from 'node:assert/strict';
import { BluetoothHeartRate } from '../src/bluetooth.ts';
import type { BluetoothCharacteristicLike, BluetoothDeviceLike, BluetoothGattLike, BluetoothProvider, BluetoothSnapshot } from '../src/bluetooth.ts';
import type { HeartRateNotification } from '../src/heart-rate.ts';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { await new Promise<void>(resolve => setImmediate(resolve)); };
type Stage = 'chooser' | 'connect' | 'service' | 'characteristic' | 'start';
function fixture(held?: Stage) {
  const log: string[] = [], states: BluetoothSnapshot[] = [], measurements: HeartRateNotification[] = [], rejected: string[] = [];
  const gate = deferred<unknown>(), stop = deferred<BluetoothCharacteristicLike>();
  let clock = 100, holdStop = false, active = 0, maxActive = 0;
  const native = <T>(name: Stage, value: T): Promise<T> => {
    log.push(name); active++; maxActive = Math.max(maxActive, active);
    return (held === name ? gate.promise.then(() => value) : Promise.resolve(value))
      .finally(() => { active--; });
  };
  class Characteristic extends EventTarget implements BluetoothCharacteristicLike {
    listeners = new Set<EventListener>();
    captured: EventListener[] = [];
    override addEventListener(type: string, listener: EventListener) { this.listeners.add(listener); this.captured.push(listener); super.addEventListener(type, listener); }
    override removeEventListener(type: string, listener: EventListener) { this.listeners.delete(listener); super.removeEventListener(type, listener); }
    properties = { notify: true, indicate: false };
    value: DataView | null = new DataView(Uint8Array.of(0, 70).buffer);
    startNotifications() { return native('start', this); }
    stopNotifications() {
      log.push('stop'); active++; maxActive = Math.max(maxActive, active);
      return (holdStop ? stop.promise : Promise.resolve(this)).finally(() => { active--; });
    }
    emit(bytes = Uint8Array.of(0, 70)) { this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.dispatchEvent(new Event('characteristicvaluechanged')); }
  }
  const characteristic = new Characteristic();
  const service = { getCharacteristic(uuid: string) { assert.equal(uuid, 'heart_rate_measurement'); return native('characteristic', characteristic); } };
  const gatt: BluetoothGattLike & { connected: boolean } = {
    connected: false,
    connect() { return native('connect', gatt).then(value => { gatt.connected = true; return value; }); },
    disconnect() { log.push('disconnect'); gatt.connected = false; },
    getPrimaryService(uuid) { assert.equal(uuid, 'heart_rate'); return native('service', service); },
  };
  class Device extends EventTarget implements BluetoothDeviceLike {
    listeners = new Set<EventListener>();
    captured: EventListener[] = [];
    override addEventListener(type: string, listener: EventListener) { this.listeners.add(listener); this.captured.push(listener); super.addEventListener(type, listener); }
    override removeEventListener(type: string, listener: EventListener) { this.listeners.delete(listener); super.removeEventListener(type, listener); }
    gatt = gatt;
    get name(): never { throw new Error('Secret device name must not be read'); }
    get id(): never { throw new Error('Secret device identity must not be read'); }
  }
  const device = new Device();
  const provider: BluetoothProvider = { requestDevice(options) { assert.deepEqual(options, { filters: [{ services: ['heart_rate'] }] }); return native('chooser', device); } };
  const transport = new BluetoothHeartRate(provider, { onState: state => states.push(state), onMeasurement: value => measurements.push(value), onRejected: reason => rejected.push(reason) }, { now: () => clock });
  return { transport, log, states, measurements, rejected, gate, stop, characteristic, device, gatt,
    setClock(value: number) { clock = value; }, holdStop() { holdStop = true; }, maxActive: () => maxActive };
}

test('requestDevice runs synchronously, exact service subscription emits no cached value', async () => {
  const f = fixture();
  const connected = f.transport.connect();
  assert.deepEqual(f.log, ['chooser']);
  assert.equal(f.transport.snapshot().phase, 'choosing');
  assert.equal(await connected, true);
  assert.deepEqual(f.log, ['chooser', 'connect', 'service', 'characteristic', 'start']);
  assert.equal(f.transport.snapshot().phase, 'connected');
  assert.ok(Number.isSafeInteger(f.transport.snapshot().connectionId));
  assert.equal(f.measurements.length, 0);
  f.transport.dispose(); await flush();
});

test('unavailable provider and disposed transport fail closed without native calls', async () => {
  const unavailable = new BluetoothHeartRate(null, { onState() {}, onMeasurement() {}, onRejected() {} });
  assert.equal(unavailable.snapshot().phase, 'unavailable'); assert.equal(await unavailable.connect(), false);
  unavailable.dispose(); assert.equal(unavailable.snapshot().phase, 'disposed'); assert.equal(await unavailable.connect(), false);
});

for (const stage of ['chooser', 'connect', 'service', 'characteristic', 'start'] as const) {
  test(`Cancel settles promptly at ${stage}, blocks a replacement until native drainage`, async () => {
    const f = fixture(stage);
    let result: boolean | undefined;
    const connecting = f.transport.connect().then(value => { result = value; });
    await flush(); assert.ok(f.log.includes(stage));
    f.transport.cancel(); await flush();
    assert.equal(result, false); assert.equal(f.transport.snapshot().phase, 'draining'); assert.equal(f.transport.snapshot().connectionId, null);
    assert.equal(await f.transport.connect(), false); assert.equal(f.log.filter(value => value === 'chooser').length, 1);
    if (stage !== 'chooser') assert.ok(f.log.includes('disconnect'), 'owned GATT disconnect is synchronous');
    else assert.ok(!f.log.includes('disconnect'), 'late chooser owns no GATT');
    const before = f.log.filter(value => value === 'disconnect').length;
    f.gate.resolve(null); await connecting; await flush();
    assert.equal(f.transport.snapshot().phase, 'idle'); assert.equal(f.maxActive(), 1);
    if (stage === 'connect') assert.ok(f.log.filter(value => value === 'disconnect').length > before, 'late connect must disconnect again');
    if (stage === 'chooser') assert.ok(!f.log.includes('disconnect'));
    assert.equal(await f.transport.connect(), true, 'same resources are reusable only after full settlement');
    f.transport.dispose(); await flush();
  });
}

test('dispose is terminal and promptly resolves a never-settling native connect', async () => {
  const f = fixture('connect'); let result: boolean | undefined;
  f.transport.connect().then(value => { result = value; }); await flush();
  f.transport.dispose(); await flush();
  assert.equal(result, false); assert.equal(f.transport.snapshot().phase, 'disposed'); assert.ok(f.log.includes('disconnect'));
  assert.equal(await f.transport.connect(), false);
  f.gate.resolve(null); await flush(); assert.equal(f.transport.snapshot().phase, 'disposed'); assert.equal(f.gatt.connected, false);
});

for (const stage of ['connect', 'service', 'characteristic', 'start'] as const) {
  test(`absolute startup deadline is checked after ${stage} even before timer delivery`, async () => {
    const f = fixture(stage); const connecting = f.transport.connect(); await flush();
    f.setClock(15100); f.gate.resolve(null);
    assert.equal(await connecting, false); await flush();
    assert.notEqual(f.transport.snapshot().phase, 'connected'); assert.equal(f.gatt.connected, false);
    assert.match(f.transport.snapshot().message, /time|again/i);
    f.transport.dispose();
  });
}

test('timer timeout settles public false while pending native operation remains draining', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture('connect'); let result: boolean | undefined;
  f.transport.connect().then(value => { result = value; }); await flush();
  t.mock.timers.tick(15000); await flush();
  assert.equal(result, false); assert.equal(f.transport.snapshot().phase, 'draining'); assert.equal(f.gatt.connected, false);
  f.gate.resolve(null); await flush(); assert.equal(f.transport.snapshot().phase, 'error'); f.transport.dispose();
});

test('chooser time is excluded; startup shares one deadline across all subsequent stages', async () => {
  const f = fixture('chooser'); const connecting = f.transport.connect();
  f.setClock(1_000_000); f.gate.resolve(null); assert.equal(await connecting, true);
  f.transport.dispose(); await flush();
});

test('early packets are suppressed; real DataView packets stamp sequence and fresh receipt clock', async () => {
  const f = fixture('start'); const connecting = f.transport.connect(); await flush();
  f.characteristic.emit(); assert.equal(f.measurements.length, 0);
  f.gate.resolve(null); assert.equal(await connecting, true);
  f.setClock(120); f.characteristic.emit(Uint8Array.of(0, 0));
  const buffer = Uint8Array.of(99, 1, 255, 255, 99);
  f.setClock(125); f.characteristic.emit(buffer.subarray(1, 4));
  assert.deepEqual(f.measurements.map(value => [value.sequence, value.receivedAtMs, value.measurement.bpm]), [[1, 120, 0], [2, 125, 65535]]);
  assert.equal(f.measurements[0]!.connectionId, f.transport.snapshot().connectionId);
  f.characteristic.emit(Uint8Array.of(0x80, 70)); assert.deepEqual(f.rejected, ['invalid-packet']); assert.equal(f.measurements.length, 2);
  f.transport.disconnect(); f.characteristic.emit(); assert.equal(f.measurements.length, 2); await flush();
});

test('queued disconnect is ignored while connected; actual disconnect retires readiness and listeners', async () => {
  const f = fixture(); assert.equal(await f.transport.connect(), true);
  f.device.dispatchEvent(new Event('gattserverdisconnected')); assert.equal(f.transport.snapshot().phase, 'connected');
  f.gatt.connected = false; f.device.dispatchEvent(new Event('gattserverdisconnected'));
  assert.equal(f.transport.snapshot().connectionId, null); f.characteristic.emit(); assert.equal(f.measurements.length, 0);
  await flush(); assert.notEqual(f.transport.snapshot().phase, 'connected'); f.transport.dispose();
});

test('subscription failure contains native secrets and disconnects before cleanup', async () => {
  const f = fixture('start'); const connecting = f.transport.connect(); await flush();
  f.gate.reject(new Error('PRIVATE_DEVICE_ADDRESS secret')); assert.equal(await connecting, false); await flush();
  assert.equal(f.gatt.connected, false); assert.ok(f.log.indexOf('disconnect') < f.log.indexOf('stop'));
  assert.ok(f.states.every(state => !JSON.stringify(state).includes('PRIVATE_DEVICE_ADDRESS'))); f.transport.dispose();
});

test('stop cleanup is serialized, disconnect immediate, rejection contained and reuse blocked', async () => {
  const f = fixture(); f.holdStop(); assert.equal(await f.transport.connect(), true);
  f.transport.disconnect(); assert.equal(f.gatt.connected, false); await flush();
  assert.equal(f.transport.snapshot().phase, 'draining'); assert.equal(await f.transport.connect(), false);
  f.stop.reject(new Error('secret stop failure')); await flush();
  assert.equal(f.transport.snapshot().phase, 'idle'); assert.equal(f.maxActive(), 1); f.transport.dispose();
});

for (const value of [NaN, Infinity, -1, 99]) {
  test(`invalid startup/receipt clock ${value} cannot publish a measurement`, async () => {
    const f = fixture(); assert.equal(await f.transport.connect(), true);
    f.setClock(value); f.characteristic.emit(); assert.equal(f.measurements.length, 0);
    assert.equal(f.transport.snapshot().connectionId, null); await flush(); f.transport.dispose();
  });
}

test('snapshot and callback states are detached; reconnection obtains a new logical ID', async () => {
  const f = fixture(); assert.equal(await f.transport.connect(), true); const id = f.transport.snapshot().connectionId;
  f.transport.snapshot().phase = 'disposed'; f.states.at(-1)!.phase = 'error'; assert.equal(f.transport.snapshot().phase, 'connected');
  f.transport.disconnect(); await flush(); assert.equal(await f.transport.connect(), true); assert.notEqual(f.transport.snapshot().connectionId, id);
  f.transport.dispose(); await flush();
});

for (const stage of ['chooser', 'connect', 'service', 'characteristic', 'start'] as const) {
  test(`native ${stage} rejection is bounded and leaves no live listeners`, async () => {
    const f = fixture(stage); const connecting = f.transport.connect(); await flush();
    f.gate.reject(new Error('SECRET MAC_ADDRESS and device name'));
    assert.equal(await connecting, false); await flush();
    assert.equal(f.transport.snapshot().phase, 'error'); assert.equal(f.transport.snapshot().connectionId, null);
    assert.equal(f.device.listeners.size, 0); assert.equal(f.characteristic.listeners.size, 0);
    assert.ok(f.states.every(state => !JSON.stringify(state).includes('SECRET')));
    assert.equal(f.maxActive(), 1); f.transport.dispose();
  });
}

test('indicate-only characteristics work; unsupported notification properties fail closed', async () => {
  for (const indicate of [false, true]) {
    const f = fixture(); f.characteristic.properties = { notify: false, indicate };
    assert.equal(await f.transport.connect(), indicate);
    assert.equal(f.log.includes('start'), indicate);
    f.transport.dispose(); await flush();
  }
});

test('retired callback closures cannot mutate a newer connection on the same objects', async () => {
  const f = fixture(); assert.equal(await f.transport.connect(), true);
  const oldMeasurement = f.characteristic.captured[0]!, oldDisconnect = f.device.captured[0]!;
  f.transport.disconnect(); await flush();
  assert.equal(f.device.listeners.size, 0); assert.equal(f.characteristic.listeners.size, 0);
  assert.equal(await f.transport.connect(), true);
  assert.equal(f.device.listeners.size, 1); assert.equal(f.characteristic.listeners.size, 1);
  oldMeasurement.call(f.characteristic, new Event('characteristicvaluechanged'));
  oldDisconnect.call(f.device, new Event('gattserverdisconnected'));
  assert.equal(f.measurements.length, 0); assert.equal(f.transport.snapshot().phase, 'connected');
  f.characteristic.emit(); assert.equal(f.measurements[0]!.sequence, 1);
  f.transport.dispose(); await flush(); assert.equal(f.device.listeners.size, 0); assert.equal(f.characteristic.listeners.size, 0);
});

test('startup clock reversal/nonfinite clock fails before another stage and readiness publication', async () => {
  for (const value of [99, NaN, Infinity]) {
    const f = fixture('service'); const connecting = f.transport.connect(); await flush();
    f.setClock(value); f.gate.resolve(null); assert.equal(await connecting, false); await flush();
    assert.equal(f.log.includes('characteristic'), false); assert.equal(f.transport.snapshot().phase, 'error');
    assert.equal(f.gatt.connected, false); f.transport.dispose();
  }
});

test('settled startup timers cannot retire a subscribed connection later', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); assert.equal(await f.transport.connect(), true);
  t.mock.timers.tick(30000); await flush(); assert.equal(f.transport.snapshot().phase, 'connected');
  f.transport.dispose(); await flush();
});

test('synchronous chooser failure returns false without exposing the thrown native error', async () => {
  const transport = new BluetoothHeartRate({ requestDevice() { throw new Error('SECRET identity'); } }, { onState() {}, onMeasurement() {}, onRejected() {} });
  assert.equal(await transport.connect(), false); await flush();
  assert.equal(transport.snapshot().phase, 'error'); assert.ok(!transport.snapshot().message.includes('SECRET'));
  transport.dispose();
});
