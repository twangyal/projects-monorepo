import { HR_LIMITS, parseHeartRate } from './heart-rate.ts';
import type { HeartRateNotification } from './heart-rate.ts';
export interface BluetoothProvider {
  requestDevice(options: { filters: { services: string[] }[] }): Promise<BluetoothDeviceLike>;
}
export interface BluetoothDeviceLike {
  gatt?: BluetoothGattLike;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}
export interface BluetoothGattLike {
  readonly connected: boolean;
  connect(): Promise<BluetoothGattLike>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BluetoothServiceLike>;
}
export interface BluetoothServiceLike {
  getCharacteristic(uuid: string): Promise<BluetoothCharacteristicLike>;
}
export interface BluetoothCharacteristicLike {
  readonly properties: { notify: boolean; indicate?: boolean };
  readonly value: DataView | null;
  startNotifications(): Promise<BluetoothCharacteristicLike>;
  stopNotifications(): Promise<BluetoothCharacteristicLike>;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}
export interface BluetoothSnapshot {
  phase: 'unavailable' | 'idle' | 'choosing' | 'connecting' | 'connected' | 'draining' | 'error' | 'disposed';
  connectionId: number | null;
  message: string;
}
export interface BluetoothCallbacks {
  onState(snapshot: BluetoothSnapshot): void;
  onMeasurement(notification: HeartRateNotification): void;
  onRejected(reason: 'invalid-packet'): void;
}
interface Attempt {
  id: number;
  retired: boolean;
  ready: boolean;
  running: boolean;
  cleaning: boolean;
  settled: boolean;
  resolve: (connected: boolean) => void;
  device?: BluetoothDeviceLike;
  gatt?: BluetoothGattLike;
  characteristic?: BluetoothCharacteristicLike;
  disconnected?: EventListener;
  notification?: EventListener;
  timer?: ReturnType<typeof setTimeout>;
  deadline?: number;
  clock?: number;
  sequence: number;
  terminal: 'idle' | 'error';
  message: string;
}

const cancelled = 'Connection cancelled. Connect again when cleanup finishes.';
const timedOut = 'Connection timed out. Connect again when cleanup finishes.';
const failed = 'Cannot connect to the heart-rate service. Check the sensor and try again.';
const invalidClock = 'The receipt clock is invalid. Disconnect and connect again.';

/** One native chain stays owned until settlement, independent of its public result. */
export class BluetoothHeartRate {
  private readonly provider: BluetoothProvider | null;
  private readonly callbacks: BluetoothCallbacks;
  private readonly now: () => number;
  private state: BluetoothSnapshot;
  private attempt: Attempt | null = null;
  private generation = 0;
  private disposed = false;

  constructor(provider: BluetoothProvider | null, callbacks: BluetoothCallbacks,
    options?: { now?: () => number }) {
    this.provider = provider;
    this.callbacks = callbacks;
    this.now = options?.now ?? (() => performance.now());
    this.state = { phase: provider ? 'idle' : 'unavailable', connectionId: null,
      message: provider ? 'Connect a standard heart-rate sensor.' : 'Web Bluetooth is unavailable in this browser.' };
  }

  connect(): Promise<boolean> {
    if (this.disposed || !this.provider) return Promise.resolve(false);
    if (this.attempt) {
      this.publish(this.state.phase, this.state.phase === 'connected'
        ? 'The sensor is connected. Disconnect before connecting again.'
        : 'Wait for the current Bluetooth operation and cleanup to finish.', this.state.connectionId);
      return Promise.resolve(false);
    }
    if (this.generation >= Number.MAX_SAFE_INTEGER) {
      this.publish('error', 'Connection limit reached. Reload before connecting again.');
      return Promise.resolve(false);
    }
    let resolve!: (connected: boolean) => void;
    const result = new Promise<boolean>(yes => { resolve = yes; });
    const attempt: Attempt = { id: ++this.generation, retired: false, ready: false,
      running: true, cleaning: false, settled: false, resolve, sequence: 0,
      terminal: 'idle', message: cancelled };
    this.attempt = attempt;
    // No await or asynchronous availability probe may precede this chooser call.
    let chooser: Promise<BluetoothDeviceLike>;
    try { chooser = this.provider.requestDevice({ filters: [{ services: ['heart_rate'] }] }); }
    catch {
      attempt.running = false;
      this.retire(attempt, 'error', failed);
      return result;
    }
    this.publish('choosing', 'Choose a standard heart-rate sensor. Cancel retires this attempt, not the native chooser.');
    // The internal chain always handles its own failure; cancellation settles only result.
    void this.start(attempt, chooser);
    return result;
  }

  cancel(): void {
    if (this.attempt) this.retire(this.attempt, 'idle', cancelled);
  }

  disconnect(): void {
    if (this.attempt) this.retire(this.attempt, 'idle', 'Sensor disconnected. Connect again to collect a new baseline.');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.attempt) this.retire(this.attempt, 'idle', 'Bluetooth input is closed.');
    else this.publish('disposed', 'Bluetooth input is closed.');
  }

  snapshot(): BluetoothSnapshot { return { ...this.state }; }

  private publish(phase: BluetoothSnapshot['phase'], message: string, connectionId: number | null = null): void {
    this.state = { phase, connectionId, message };
    // Consumer callbacks cannot break ownership cleanup or leak rejected native promises.
    try { this.callbacks.onState(this.snapshot()); } catch { /* Isolated consumer callback. */ }
  }

  private current(attempt: Attempt): boolean {
    return !this.disposed && this.attempt === attempt && !attempt.retired;
  }

  private settle(attempt: Attempt, connected: boolean): void {
    if (attempt.settled) return;
    attempt.settled = true;
    attempt.resolve(connected);
  }

  private clock(attempt: Attempt): number {
    const value = this.now();
    if (!Number.isFinite(value) || value < 0 || (attempt.clock !== undefined && value < attempt.clock)) {
      throw new Error('clock');
    }
    attempt.clock = value;
    return value;
  }

  private checkpoint(attempt: Attempt): boolean {
    if (!this.current(attempt)) return false;
    let now: number;
    try { now = this.clock(attempt); }
    catch { this.retire(attempt, 'error', invalidClock); return false; }
    if (attempt.deadline !== undefined && now >= attempt.deadline) {
      this.retire(attempt, 'error', timedOut);
      return false;
    }
    return true;
  }

  private async start(attempt: Attempt, chooser: Promise<BluetoothDeviceLike>): Promise<void> {
    try {
      const device = await chooser;
      // A cancelled chooser did not acquire GATT and must not disconnect its result.
      if (!this.current(attempt)) return;
      let began: number;
      try { began = this.clock(attempt); }
      catch { this.retire(attempt, 'error', invalidClock); return; }
      attempt.deadline = began + HR_LIMITS.connectTimeoutMs;
      if (!Number.isFinite(attempt.deadline) || attempt.deadline <= began) {
        this.retire(attempt, 'error', invalidClock); return;
      }
      const gatt = device.gatt;
      if (!gatt) { this.retire(attempt, 'error', failed); return; }
      attempt.device = device;
      attempt.gatt = gatt;
      attempt.timer = setTimeout(() => {
        if (this.current(attempt)) this.retire(attempt, 'error', timedOut);
      }, HR_LIMITS.connectTimeoutMs);
      this.publish('connecting', 'Connecting to the standard heart-rate service.');
      if (!this.current(attempt)) return;
      await attempt.gatt.connect();
      if (!this.checkpoint(attempt)) return;
      attempt.disconnected = () => {
        if (!this.current(attempt) || attempt.gatt?.connected) return;
        this.retire(attempt, 'error', 'The sensor disconnected. Connect again and collect a new baseline.');
      };
      device.addEventListener('gattserverdisconnected', attempt.disconnected);
      const service = await attempt.gatt.getPrimaryService('heart_rate');
      if (!this.checkpoint(attempt)) return;
      const characteristic = await service.getCharacteristic('heart_rate_measurement');
      // Own returned cleanup resources even when the await crossed retirement.
      attempt.characteristic = characteristic;
      if (!this.checkpoint(attempt)) return;
      if (!characteristic.properties.notify && !characteristic.properties.indicate) {
        this.retire(attempt, 'error', 'This heart-rate characteristic does not support notifications.'); return;
      }
      attempt.notification = () => this.receive(attempt);
      characteristic.addEventListener('characteristicvaluechanged', attempt.notification);
      await characteristic.startNotifications();
      if (!this.checkpoint(attempt)) return;
      if (!attempt.gatt.connected) {
        this.retire(attempt, 'error', 'The sensor disconnected. Connect again and collect a new baseline.'); return;
      }
      this.clearTimer(attempt);
      attempt.ready = true;
      this.publish('connected', 'Receiving standard heart-rate notifications. Device compatibility and accuracy are unverified.', attempt.id);
      if (this.current(attempt)) this.settle(attempt, true);
    } catch {
      if (this.current(attempt)) this.retire(attempt, 'error', failed);
    } finally {
      attempt.running = false;
      if (attempt.retired) {
        // connect() may have completed after an earlier disconnect was a no-op.
        this.disconnectOwned(attempt);
        await this.cleanup(attempt);
      }
    }
  }

  private receive(attempt: Attempt): void {
    if (!this.current(attempt) || !attempt.ready) return;
    let receivedAtMs: number;
    try { receivedAtMs = this.clock(attempt); }
    catch { this.retire(attempt, 'error', invalidClock); return; }
    let measurement;
    try {
      const value = attempt.characteristic?.value;
      if (!value) throw new Error('packet');
      measurement = parseHeartRate(value);
    } catch {
      try { this.callbacks.onRejected('invalid-packet'); } catch { /* Isolated consumer callback. */ }
      return;
    }
    if (!this.current(attempt) || !attempt.ready) return;
    if (attempt.sequence >= Number.MAX_SAFE_INTEGER) {
      this.retire(attempt, 'error', 'Notification limit reached. Connect again to collect a new baseline.'); return;
    }
    const notification: HeartRateNotification = { connectionId: attempt.id, sequence: ++attempt.sequence,
      receivedAtMs, measurement: { ...measurement } };
    try { this.callbacks.onMeasurement(notification); } catch { /* Isolated consumer callback. */ }
  }

  private clearTimer(attempt: Attempt): void {
    if (attempt.timer !== undefined) clearTimeout(attempt.timer);
    attempt.timer = undefined;
  }

  private disconnectOwned(attempt: Attempt): void {
    try { attempt.gatt?.disconnect(); } catch { /* Fixed status already describes retirement. */ }
  }

  private retire(attempt: Attempt, terminal: 'idle' | 'error', message: string): void {
    if (this.attempt !== attempt) return;
    if (attempt.retired) {
      if (this.disposed) this.publish('disposed', 'Bluetooth input is closed.');
      return;
    }
    attempt.retired = true;
    attempt.ready = false;
    attempt.terminal = terminal;
    attempt.message = message;
    this.clearTimer(attempt);
    if (attempt.device && attempt.disconnected) {
      try { attempt.device.removeEventListener('gattserverdisconnected', attempt.disconnected); } catch { /* Cleanup continues. */ }
    }
    if (attempt.characteristic && attempt.notification) {
      try { attempt.characteristic.removeEventListener('characteristicvaluechanged', attempt.notification); } catch { /* Cleanup continues. */ }
    }
    this.disconnectOwned(attempt);
    this.settle(attempt, false);
    this.publish(this.disposed ? 'disposed' : 'draining', this.disposed ? 'Bluetooth input is closed.' : message);
    // Never overlap stopNotifications with an outstanding startup operation.
    if (!attempt.running) void this.cleanup(attempt);
  }

  private async cleanup(attempt: Attempt): Promise<void> {
    if (attempt.cleaning) return;
    attempt.cleaning = true;
    try {
      if (attempt.characteristic) await attempt.characteristic.stopNotifications();
    } catch { /* Cleanup rejection contains no actionable device information. */ }
    finally {
      this.clearTimer(attempt);
      if (this.attempt === attempt) {
        this.attempt = null;
        if (this.disposed) this.publish('disposed', 'Bluetooth input is closed.');
        else this.publish(attempt.terminal, attempt.message);
      }
    }
  }
}
