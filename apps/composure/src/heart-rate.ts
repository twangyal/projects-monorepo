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
  constructor(code:'packet'|'clock'|'calibration', message:string) {
    super(message); this.name='HeartRateError'; this.code=code;
  }
}
export function parseHeartRate(value:DataView|Uint8Array):HeartRateMeasurement {
  const invalid = () => new HeartRateError('packet','Invalid standard heart-rate packet.');
  try {
    if (!(value instanceof DataView) && !(value instanceof Uint8Array)) throw invalid();
    const length = value.byteLength;
    if (length < 2 || length > HR_LIMITS.packetBytes) throw invalid();
    const view = value instanceof DataView ? value : new DataView(value.buffer,value.byteOffset,length);
    const flags = view.getUint8(0);
    if (flags & 0xe0) throw invalid();
    const wide = Boolean(flags & 1);
    let offset = wide ? 3 : 2;
    if (length < offset) throw invalid();
    const bpm = wide ? view.getUint16(1,true) : view.getUint8(1);
    const contactBits = (flags >> 1) & 3;
    const contact:ContactStatus = contactBits < 2 ? 'unknown' : contactBits === 2 ? 'not-detected' : 'detected';
    const energyPresent = Boolean(flags & 8);
    if (energyPresent) offset += 2;
    if (offset > length) throw invalid();
    const remaining = length - offset;
    const rrPresent = Boolean(flags & 0x10);
    if (rrPresent ? remaining < 2 || remaining % 2 !== 0 : remaining !== 0) throw invalid();
    return {bpm,contact,energyPresent,rrCount:rrPresent ? remaining / 2 : 0};
  } catch(error) {
    if (error instanceof HeartRateError) throw error;
    // Detached buffers and invalid views use the same bounded, identity-free error.
    throw invalid();
  }
}

function admitClock(time:number, floor:number):void {
  if (!Number.isFinite(time) || time < 0 || time < floor) {
    throw new HeartRateError('clock','Heart-rate time must be finite, nonnegative and monotonic.');
  }
}

export class HeartRateCalibration {
  #connectionId:number;
  #startedAtMs:number;
  #clock:number;
  #sequence=0;
  #state:CalibrationSnapshot['state']='collecting';
  #samples:CalibrationSample[]=[];
  #result:CalibrationResult|null=null;

  constructor(connectionId:number, startedAtMs:number) {
    if (!Number.isSafeInteger(connectionId) || connectionId <= 0) {
      throw new HeartRateError('calibration','Calibration requires a positive safe connection generation.');
    }
    admitClock(startedAtMs,0);
    this.#connectionId=connectionId;
    this.#startedAtMs=startedAtMs;
    this.#clock=startedAtMs;
  }

  observe(notification:HeartRateNotification):boolean {
    // Foreign and replayed packets cannot invalidate or advance this collection.
    if (notification.connectionId !== this.#connectionId) return false;
    if (!Number.isSafeInteger(notification.sequence) || notification.sequence <= 0) {
      throw new HeartRateError('calibration','Calibration requires a positive safe notification sequence.');
    }
    if (notification.sequence <= this.#sequence) return false;
    const time=notification.receivedAtMs;
    admitClock(time,this.#clock);
    this.#clock=time;
    this.#sequence=notification.sequence;
    const {bpm,contact}=notification.measurement;
    if (contact === 'not-detected' && (this.#state === 'collecting' || this.#state === 'ready')) {
      this.invalidate();
      return false;
    }
    this.#expire(time);
    if (this.#state !== 'collecting' || (contact !== 'unknown' && contact !== 'detected') ||
        !Number.isInteger(bpm) || bpm < 40 || bpm > 120) return false;
    const previous=this.#samples.at(-1);
    if (previous && time-previous.receivedAtMs < HR_LIMITS.sampleIntervalMs) return false;
    this.#samples.push({bpm,sequence:notification.sequence,receivedAtMs:time});
    if (this.#samples.length === HR_LIMITS.calibrationSamples) {
      const values=this.#samples.map(sample=>sample.bpm);
      const span=time-this.#samples[0]!.receivedAtMs;
      if (span < HR_LIMITS.calibrationSpanMs || Math.max(...values)-Math.min(...values) > 12) {
        this.#state='failed';
      } else {
        this.#state='ready';
        this.#result={connectionId:this.#connectionId,startedAtMs:this.#startedAtMs,completedAtMs:time,
          baseline:values.reduce((sum,value)=>sum+value,0)/HR_LIMITS.calibrationSamples,
          samples:this.#samples.map(sample=>({...sample}))};
      }
    }
    return true;
  }

  snapshot(nowMs:number):CalibrationSnapshot {
    admitClock(nowMs,this.#clock);
    this.#clock=nowMs;
    this.#expire(nowMs);
    return {state:this.#state,count:this.#samples.length,
      result:this.#state === 'ready' && this.#result ?
        {...this.#result,samples:this.#result.samples.map(sample=>({...sample}))} : null};
  }

  invalidate():void {
    this.#state='invalidated';
    this.#samples=[];
    this.#result=null;
  }

  #expire(time:number):void {
    if ((this.#state === 'collecting' && time-this.#startedAtMs > HR_LIMITS.calibrationWindowMs) ||
        (this.#state === 'ready' && this.#result && time-this.#result.completedAtMs > HR_LIMITS.freshMs)) {
      this.#state='expired';
      this.#result=null;
    }
  }
}
