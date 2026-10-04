# Composure standard Bluetooth heart-rate input

Issue: https://github.com/twangyal/projects-monorepo/issues/61. Physical smartwatch verification remains separate and blocked: https://github.com/twangyal/projects-monorepo/issues/62.

## Scope and product truth

Add a usable software flow: explicit connection to a standard BLE Heart Rate service, five received baseline notifications, a run whose input source cannot change, safe signal loss/pause, and a source-labeled JSON report. Preserve the existing simulator, authored scare/game mechanics, keyboard/pointer controls, preferences and simulated best time. This is a game input adapter, not emotion inference, medical analysis or proof of a watch's compatibility or measurement accuracy. No synthetic readings may substitute for Bluetooth notifications. No accounts, network service, new package, generic Bluetooth services, automatic reconnect, reading polling, device information or device identity storage.

Browser support requires a secure context, transient user activation and Web Bluetooth. Chromium and Chrome Android support the API; Linux Chromium support is not enabled by default, and Firefox, Safari/iOS and Android WebView are unsupported. Presence of `navigator.bluetooth` proves only an exposed API, not hardware availability. Controlled browser tests verify software/protocol behavior; actual watch acceptance stays open in #62.

## Standards and parsing

References: historical SIG-authored [Heart Rate Measurement XML](https://github.com/oesmith/gatt-xml/blob/master/org.bluetooth.characteristic.heart_rate_measurement.xml), [Heart Rate service XML](https://github.com/oesmith/gatt-xml/blob/master/org.bluetooth.service.heart_rate.xml), [MDN Web Bluetooth](https://github.com/mdn/content/blob/main/files/en-us/web/api/web_bluetooth_api/index.md), and [MDN browser compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/Bluetooth.json). The XML is a historical mirror, not a claim that the latest official standard was downloaded.

Subscribe only to service `heart_rate` (0x180D), characteristic `heart_rate_measurement` (0x2A37). Request filter is exactly `{filters:[{services:['heart_rate']}]}`. A characteristic must support `notify` or `indicate`; use `startNotifications`, never `readValue` or control-point writes.

Admit only 2–512 byte packets. Flags bit0 chooses unsigned 8-bit or little-endian 16-bit BPM. Contact bits1–2 values 0 AND 1 mean unsupported/unknown (flags 0x02 is valid), value2 means supported/not detected, value3 detected. Bit3 appends exactly two energy bytes; bit4 requires at least one complete two-byte RR interval and an even remaining tail. Without bit4 there must be no trailing bytes. Reject RFU bits5–7, truncation and invalid lengths. Use the actual DataView/Uint8Array offset and length; never retain its mutable backing buffer. Energy and RR are structurally validated but not used by the game; return their presence/count, not medical interpretations. Protocol BPM 0–65535 is structurally valid; game and calibration admission are narrower.

## Frozen protocol/calibration API — src/heart-rate.ts

```ts
export const HR_LIMITS = {
  packetBytes:512, sampleIntervalMs:1000, calibrationSamples:5,
  calibrationWindowMs:30000, calibrationSpanMs:4000,
  freshMs:10000, connectTimeoutMs:15000,
} as const;
export type ContactStatus = 'unknown'|'detected'|'not-detected';
export interface HeartRateMeasurement {
  bpm:number; contact:ContactStatus; energyPresent:boolean; rrCount:number;
}
export interface HeartRateNotification {
  connectionId:number; sequence:number; receivedAtMs:number;
  measurement:HeartRateMeasurement;
}
export interface CalibrationSample {
  bpm:number; sequence:number; receivedAtMs:number;
}
export interface CalibrationResult {
  connectionId:number; startedAtMs:number; completedAtMs:number;
  baseline:number; samples:CalibrationSample[];
}
export interface CalibrationSnapshot {
  state:'collecting'|'ready'|'expired'|'failed'|'invalidated';
  count:number; result:CalibrationResult|null;
}
export class HeartRateError extends Error {
  readonly code:'packet'|'clock'|'calibration';
  constructor(code:'packet'|'clock'|'calibration', message:string);
}
export function parseHeartRate(value:DataView|Uint8Array):HeartRateMeasurement;
export class HeartRateCalibration {
  constructor(connectionId:number, startedAtMs:number);
  observe(notification:HeartRateNotification):boolean;
  snapshot(nowMs:number):CalibrationSnapshot;
  invalidate():void;
}
```

All times are monotonic milliseconds from the same `performance.now()` clock, finite and nonnegative. Connection IDs and notification sequences are positive safe integers; IDs are logical generations, never device identifiers. Calibration observes only its connection, strictly increasing sequences, nondecreasing receipt times, contact unknown/detected and integer BPM40–120. Distinct accepted samples must be at least1000ms apart; five span at least4000ms, occur between start and start+30000ms inclusive, and have spread at most12BPM. Bursts, duplicates, wrong connection and ineligible measurements do not count. Decreasing/nonfinite time is a bounded error before mutation. Equal times cannot count twice. Five samples with excessive spread enter `failed`; expiration or failure requires an explicit new collection, not silent rolling replacement. Baseline is their arithmetic mean. Ready results expire when `nowMs-completedAtMs>10000`; subsequent packets do not refresh an old result. A new current-connection notification reporting supported contact NOT detected immediately invalidates collecting OR ready calibration, regardless of its BPM; a previously fresh baseline cannot be started after reported contact loss. This requires explicit new Collect baseline.

Use ONE calibration clock watermark initialized to constructor startedAtMs and shared by observe/snapshot. First reject wrong connection or nonincreasing sequence without changing any state or watermark; such packets cannot affect another collection. For a new current-connection sequence, validate finite receipt time>=watermark before any mutation, then advance sequence/clock watermarks even if BPM or spacing prevents acceptance. Snapshot validates finite nowMs>=watermark before mutation and advances that same clock. Thus snapshot(5000) followed by a new-sequence receipt at4000 is a clock error. Contact loss is handled after connection/sequence/clock checks but BEFORE BPM bounds, sample-spacing throttling or ready-state reuse: even BPM0 or a burst contact-loss notification invalidates calibration. Collection expires only when now is strictly greater than start+30000ms; ready freshness expires only when age is strictly greater than10000ms. Snapshot count is the number of accepted samples (including five in failed/expired states); result is non-null only in ready. Explicit invalidation, including contact loss, sets invalidated/count0/resultnull and cannot be revived. `snapshot` returns detached data; no caller can alter internal samples. Arrays must be dense with own indices; sparse arrays cannot produce a baseline.

## Frozen browser transport API — src/bluetooth.ts

```ts
export interface BluetoothProvider {
  requestDevice(options:{filters:{services:string[]}[]}):Promise<BluetoothDeviceLike>;
}
export interface BluetoothDeviceLike {
  gatt?:BluetoothGattLike;
  addEventListener(type:string, listener:EventListener):void;
  removeEventListener(type:string, listener:EventListener):void;
}
export interface BluetoothGattLike {
  readonly connected:boolean;
  connect():Promise<BluetoothGattLike>; disconnect():void;
  getPrimaryService(uuid:string):Promise<BluetoothServiceLike>;
}
export interface BluetoothServiceLike {
  getCharacteristic(uuid:string):Promise<BluetoothCharacteristicLike>;
}
export interface BluetoothCharacteristicLike {
  readonly properties:{notify:boolean; indicate?:boolean};
  readonly value:DataView|null;
  startNotifications():Promise<BluetoothCharacteristicLike>;
  stopNotifications():Promise<BluetoothCharacteristicLike>;
  addEventListener(type:string, listener:EventListener):void;
  removeEventListener(type:string, listener:EventListener):void;
}
export interface BluetoothSnapshot {
  phase:'unavailable'|'idle'|'choosing'|'connecting'|'connected'|'draining'|'error'|'disposed';
  connectionId:number|null; message:string;
}
export interface BluetoothCallbacks {
  onState(snapshot:BluetoothSnapshot):void;
  onMeasurement(notification:HeartRateNotification):void;
  onRejected(reason:'invalid-packet'):void;
}
export class BluetoothHeartRate {
  constructor(provider:BluetoothProvider|null, callbacks:BluetoothCallbacks,
    options?:{now?:()=>number});
  connect():Promise<boolean>;
  cancel():void; disconnect():void; dispose():void;
  snapshot():BluetoothSnapshot;
}
```

Production binds the real `navigator.bluetooth` at a narrow structural boundary and uses `performance.now`. A null provider exposes unavailable state; fixtures inject only the browser-facing provider and clock, never fallback BPM. `connect` invokes requestDevice synchronously before its first await and resolves true only for the current fully subscribed connection; expected failure/cancel resolves false without leaking a rejection. State messages are fixed and actionable, never raw native error text. No device name/id is read, copied into a snapshot, displayed, saved or reported.

The public connect Promise resolves false PROMPTLY on logical Cancel, timeout or dispose, independently of an unresolved native promise. Track that native attempt separately through draining/cleanup; public cancellation must not await it. Connected snapshots carry a positive safe-integer connectionId; retirement clears readiness/connectionId immediately. Exhaustion of the bounded integer generation space fails closed. An invalid injected receipt clock emits no measurement or raw error text.

There is at most ONE outstanding native asynchronous operation/attempt, including a cancelled chooser and cleanup. Cancel/timeout immediately retire callbacks and invalidate logical readiness, but cannot physically abort a chooser or GATT promise. Until the pending native promise and any owned cleanup settle, phase is `draining` and another Connect is refused with clear waiting feedback. No queue or unbounded abandoned attempts. The startup deadline is15000ms measured after a chooser succeeds across connect/service/characteristic/subscribe, not15000ms per stage; chooser time is excluded. Timeout retires the attempt and handles eventual resolution. This deliberately conservative admission also forbids reuse of a still-pending GATT object. Simulator/report controls remain available while draining.

Check the captured monotonic startup deadline synchronously after EVERY awaited startup stage, including final startNotifications, before publishing readiness or continuing. At elapsed>=15000ms the attempt times out, even if a delayed timer callback has not run; a late promise cannot publish connected. Reject nonfinite/decreasing clock values before state publication and retire owned resources safely. Timer-based retirement supplements this deadline check; it does not replace it.

Check generation/disposal and ownership after every await. Claim the chosen GATT resource before connect; a late chooser does not own a connection and must not blindly disconnect it. Attach the disconnect listener after successful connect, and ignore a queued disconnected event while `gatt.connected` is true. Attach the characteristic handler before startNotifications, but suppress packets until the current subscription is ready. On retirement remove only its handlers and synchronously disconnect ONLY its owned GATT immediately, even while connect/startNotifications or stopNotifications is pending. Physical disconnection must not wait for a potentially never-settling native promise. Defer any asynchronous stopNotifications cleanup until the existing native operation settles; never overlap asynchronous native operations. Catch delayed cleanup rejection, recheck ownership, and remain draining until pending operation/cleanup settles. After a late successful connect, repeat the owned synchronous disconnect before drainage completes, because the early disconnect may have been a no-op. Dispose is terminal even while this bounded cleanup is pending. Timers and callbacks are bounded and removed on settlement. Read/parse characteristic.value synchronously only in a current notification callback, stamp a fresh receipt clock and sequence, and never emit a cached initial reading.

Generation guards reject retired callback closures and pending-operation results. Web Bluetooth exposes no native session ID on events: do not claim authentication of an event newly dispatched onto a reused same characteristic, or arbitrary physical packet/session attribution. There is no auto reconnect. Ordinary window blur pauses gameplay but does not cancel the native chooser; explicit Cancel, hidden document, pagehide and disposal retire the transport.

## Frozen model additions — src/model.ts

```ts
export type RunSource = 'simulated'|'bluetooth-hr';
export interface BluetoothRunOrigin {
  source:'bluetooth-hr'; calibration:CalibrationResult; startedAtMs:number;
}
export function newRun(baseline:number, scares:boolean, origin?:BluetoothRunOrigin):Run;
export function sampleBluetooth(run:Run, notification:HeartRateNotification):boolean;
export function invalidateBluetooth(run:Run,
  reason:'disconnected'|'contact-lost'|'paused'|'hidden'|'invalid-clock'):void;
export function resume(run:Run, nowMs?:number):void;
export function advance(run:Run, elapsed:number, controls:Controls, nowMs?:number):void;
// Existing sample(run,bpm), pause(run), calibrate(), runReport() remain public.
```

Add readonly `source:RunSource` and readonly `calibration:CalibrationResult|null` to Run; baseline becomes readonly. Runtime-lock those origin fields and freeze a detached nested calibration snapshot, not the entire mutable game. Internal BLE freshness/sequence state may remain private to model.ts. Validate supplied calibration shape, five dense samples/spacing/span/range/spread/mean/connection and age again at newRun. New BLE runs start with NO gameplay reading; calibration samples are not replayed. Simulator newRun/sample/advance behavior and signatures remain compatible, and `sample` refuses every Bluetooth run.

`sampleBluetooth` only admits running BLE runs, their pinned connection, increasing sequence and nondecreasing receipt clocks, contact unknown/detected, integer35–220BPM, receipt after run start/resume, and at least1000ms since last accepted gameplay sample. Initialize the BLE sequence watermark from the final calibration sample, so that sample cannot be replayed into gameplay. Filter wrong connection/nonincreasing sequence without changing this run; for a new matching sequence validate the receipt clock before mutation, then advance observation watermarks even when gameplay acceptance is throttled. Contact not detected immediately invalidates the usable gate BEFORE the one-second throttling or BPM bounds, including a burst or BPM0 contact-loss notification. Invalid clocks cannot mutate/invalidate another connection's state. There is no sample buffering during pause. Malformed or out-of-range values never refresh usable freshness. Reconnection obtains a new connection ID and requires a new baseline/new run; it cannot rewrite the old run's source or calibration.

BLE advance and resume require finite nondecreasing nowMs, supplied from `performance.now()` (not active time, Date.now or a different clock). Validate it before ANY mutation, including sub-step/no-tick advance. BLE freshness is age<=10000ms by wall receipt time, with no widening epsilon; tick uses that separate gate, never the last historical sample's active time. Pause/resume/disconnect/hidden invalidate only usable reading state, preserving sample/event history. Resume establishes a new receipt cutoff and requires a later notification; no pre-pause reading resurrects. Missing/stale input contributes zero physiological tension while existing authored shock/smoothing still applies. Preserve simulator active-time freshness and pause semantics. Add dense-array rejection to existing calibrate, preserving valid simulated behavior.

The BLE model has ONE shared monotonic clock floor initialized from run startedAtMs, advanced by structurally valid new matching notifications, advance and resume. Wrong connection/duplicate sequence returns false BEFORE clock checks. A structurally valid new matching notification consumes its sequence even if spacing/BPM/contact excludes gameplay acceptance. Matching nonfinite/decreasing clock throws before ANY mutation. This is the same observation-watermark rule as calibration; an intervening advance/resume cannot permit an older receipt clock.

Keep existing `Reading.time` and `bpm`; BLE readings additionally include `receivedSeconds` relative to calibration.startedAtMs. Preserve256 samples/events and truncation flags. Simulator reports remain EXACT schema1 and existing keys. BLE reports are schema2 with source `bluetooth-hr`, existing scenario/outcome/objective/active-time/history fields, and `calibration:{baselineBpm,samples:[{bpm,receivedSeconds}],spanSeconds,runStartedSeconds}`. BLE sample records contain active `time` and relative `receivedSeconds`; reports contain no absolute clock origin, device identity, raw packets, energy/RR data or internal connection ID. Fixed limitations say received standard-HR notifications, device compatibility/accuracy unverified, no emotion/medical inference and no deterministic replay. Detached report data cannot mutate a run. No model authentication receipts/import subsystem is introduced.

## UI contract and lifecycle — main.ts/style.css

Use stable DOM, preserving current simulator labels and all six browser tests. Add select `#input-source`, label **Next run source**, values `simulated` (**Simulator**) and `bluetooth-hr` (**Bluetooth heart-rate sensor**). It is not persisted. `#run-source` explicitly displays **Current run source**. Selecting a next source never rewrites the existing run. Separate `#ble-status` and `#ble-calibration` polite status nodes cannot be overwritten by ordinary game messages.

Controls: `#ble-connect` **Connect heart-rate sensor**, `#ble-cancel` **Cancel connection**, `#ble-disconnect` **Disconnect sensor**, `#ble-calibrate` **Collect baseline**. Count0/5 and actual received baseline are visible. Connect/Collect release held movement and pause an old running game. No device names appear. Fixed help discloses energy/RR ignored and hardware unverified. BLE Start uses existing #start with label **Start Bluetooth run**; simulator keeps **Calibrate & start**. Start requires current connected generation and fresh complete calibration. Construct/validate a candidate before replacing any old run, obtain native confirmation when a run exists (its in-memory report will be replaced), and RECHECK connected generation/calibration age after confirmation before publication. Do not feed slider/calibration values into new BLE gameplay.

Three simulator injection paths—start, automatic active-second sample and manual Send—must check immutable run.source. Simulator reading/baseline/auto/manual controls stay visible but cannot contaminate a BLE run. Existing Settings schema1/key/validation remain unchanged. A BLE baseline never changes declared simulator baseline; BLE wins never update simulated best time. Report filename is source-specific. Simulator Restart behavior remains; Bluetooth Restart requires new Collect baseline and explicit Start rather than reusing cached readings. Previous run/report remains until confirmed successful replacement.

Notifications go to explicit active calibration OR the matching running BLE run, never both. A ready baseline awaiting Start cannot be refreshed by unrelated packets. Paused gameplay drops readings without buffering. Blur releases controls/pauses and invalidates a BLE run's usable reading, but does NOT cancel connection. Hidden document and pagehide also retire transport and invalidate pending calibration; pagehide is terminal for this page lifetime. Disconnect/connection failure invalidates pending calibration and usable current-BLE reading. Source changes invalidate pending calibration/Start intent and cancel pending connection work; an existing BLE run remains correctly labeled. Switching to a simulator run disconnects BLE only when the new confirmed run is published. UI callbacks recheck transport/run/collection generations and never mutate a newer run. No automatic retry/reconnect or synthetic initial BPM.

Explicit connection cancellation promises only logical cancellation, not dismissal of the browser chooser. Draining feedback leaves simulator, existing report and preferences usable. Select focus-visible styling and existing44px touch targets are required. No repeated full-game DOM replacement or native promise errors reaching unhandled rejection handlers.

## Ownership and verification

1. Protocol/calibration owner: heart-rate.ts + tests/heart-rate.test.ts. Publish types/constants and callable producer APIs first.
2. Transport owner: bluetooth.ts + tests/bluetooth.test.ts. Structural native boundary only; no UI/model ownership.
3. Model owner: model.ts + new tests/bluetooth-model.test.ts. Preserve existing tests/model.test.ts unchanged. The narrow sparse-array prerequisite is already released separately in tests/calibration-validation.test.ts; preserve that implementation/tests. Settings remain untouched.
4. UI owner: main.ts + style.css. Simulator routing, safe source controls, status/focus/settings best guard.
5. Independent oracle/browser owner: tests/heart-rate-oracle.test.ts + tests/browser/bluetooth.spec.ts and optional bluetooth-fixtures.ts. No producer source changes; root may split these two test roles across idle agents.
6. Root: tooling/README/evidence/catalog/Git/CI and coordinated shared builds/port4281. Spec author performs final independent read-only source review.

Producer tests must observe meaningful RED then GREEN. Independent protocol cases include flags0x02, offset DataViews,8/16-bit values, all optional-field lengths, RFU/truncation/max payload, structurally valid but game-ineligible BPM. Calibration covers bursts, spacing/span/timeout/spread, sparse arrays, clock reversal, detached output and stale readiness. Model tests cover zero initial BLE reading, source refusal/mixing, wall freshness versus pause/active time, post-resume receipt, history retained, immutable origin, simulator report compatibility and BLE-relative report.

Transport tests defer chooser/connect/service/characteristic/startNotifications individually, including cancel/timeout/dispose, late result, draining admission, same-resource reuse after settlement, queued disconnect with connected=true, listener-before-subscribe, early packet suppression, subscribe/stop rejection cleanup, exact synchronous requestDevice invocation and no initial cached reading. Test bounded attempts/listeners/timers and fixed identity-free errors.

Native Chromium acceptance injects only navigator.bluetooth using native EventTarget/DataView notifications and deferred browser promises; never calls model or game state globals. Verify explicit connect→five spaced actual notifications→keyboard escape→actual JSON download→settings/reload, plus contact loss, paused/dropped samples, hidden teardown, monotonic calibration timing, each late async boundary and source/best isolation. Run legacy six browser cases unchanged plus new cases, unit/lint/typecheck/build. These are controlled browser software checks, not physical watch evidence; #62 records remaining real smartwatch, browser/OS, contact, reconnect, timestamp and accuracy checks.
