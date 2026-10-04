import test from 'node:test';
import assert from 'node:assert/strict';
import { HeartRateCalibration, HeartRateError, HR_LIMITS, parseHeartRate } from '../src/heart-rate.ts';
import type { ContactStatus, HeartRateNotification } from '../src/heart-rate.ts';

const packet = (...bytes:number[]) => parseHeartRate(Uint8Array.from(bytes));
const errorCode = (code:HeartRateError['code']) => (error:unknown) => error instanceof HeartRateError && error.code === code;
function notification(sequence:number, receivedAtMs:number, bpm=70, contact:ContactStatus='detected', connectionId=1):HeartRateNotification {
  return { connectionId, sequence, receivedAtMs, measurement:{bpm,contact,energyPresent:false,rrCount:0} };
}
function ready(start=0):HeartRateCalibration {
  const collection = new HeartRateCalibration(1,start);
  for(let i=0;i<5;i++) assert.equal(collection.observe(notification(i+1,start+i*1000,68+i)),true);
  return collection;
}

test('SIG contact flags include valid unsupported contact bit 0x02',()=>{
  for(const [flags,contact] of [[0,'unknown'],[2,'unknown'],[4,'not-detected'],[6,'detected']] as const) {
    assert.deepEqual(packet(flags,70),{bpm:70,contact,energyPresent:false,rrCount:0});
  }
  assert.equal(packet(1,0xff,0xff).bpm,65535);
  assert.equal(packet(0,0).bpm,0);
  assert.equal(packet(1,0x2c,1).bpm,300);
});

test('reads only DataView and Uint8Array offsets and leaves backing bytes untouched',()=>{
  const backing = Uint8Array.of(0xff,0xff,0x1f,0x34,0x12,1,2,3,4,5,6,0xff);
  const before = backing.slice();
  const view = new DataView(backing.buffer,2,9);
  const expected = {bpm:0x1234,contact:'detected',energyPresent:true,rrCount:2};
  assert.deepEqual(parseHeartRate(view),expected);
  assert.deepEqual(parseHeartRate(backing.subarray(2,11)),expected);
  assert.deepEqual(backing,before);
  const result = parseHeartRate(view);
  backing.fill(0);
  assert.deepEqual(result,expected);
});

test('energy and RR fields require exact structural lengths',()=>{
  assert.deepEqual(packet(8,72,0,0),{bpm:72,contact:'unknown',energyPresent:true,rrCount:0});
  assert.equal(packet(0x10,72,0,0).rrCount,1);
  assert.equal(packet(0x19,72,0,0,0,0,0,0,0).rrCount,2);
  for(const bytes of [[],[0],[1,70],[8,70],[8,70,0],[0,70,0],[8,70,0,0,0],[0x10,70],[0x10,70,0],[0x10,70,0,0,0],[0x19,70,0,0,0]]) {
    assert.throws(()=>parseHeartRate(Uint8Array.from(bytes)),errorCode('packet'));
  }
});

test('all defined flag combinations preserve exact optional-field counts',()=>{
  for(let flags=0;flags<32;flags++) {
    const wide=Boolean(flags & 1), energy=Boolean(flags & 8), rr=Boolean(flags & 16);
    const bytes=[flags,wide ? 0x2c : 77];
    if(wide) bytes.push(1);
    if(energy) bytes.push(0xab,0xcd);
    if(rr) bytes.push(0,0,0xff,0xff,1,0);
    const expectedContact=['unknown','unknown','not-detected','detected'][(flags >> 1) & 3];
    assert.deepEqual(parseHeartRate(Uint8Array.from(bytes)),{
      bpm:wide ? 300 : 77,contact:expectedContact,energyPresent:energy,rrCount:rr ? 3 : 0,
    });
    assert.throws(()=>parseHeartRate(Uint8Array.from([...bytes,0])),errorCode('packet'));
    assert.throws(()=>parseHeartRate(Uint8Array.from(bytes.slice(0,-1))),errorCode('packet'));
  }
});

test('rejects reserved bits and enforces packet maximum before optional parsing',()=>{
  for(let flags=0x20;flags<=0xff;flags++) assert.throws(()=>packet(flags,70,0),errorCode('packet'));
  const maximum = new Uint8Array(HR_LIMITS.packetBytes);
  maximum[0]=0x10; maximum[1]=70;
  assert.equal(parseHeartRate(maximum).rrCount,255);
  assert.throws(()=>parseHeartRate(new Uint8Array(513)),errorCode('packet'));
  const shortMaximum = maximum.subarray(0,511);
  assert.throws(()=>parseHeartRate(shortMaximum),errorCode('packet'));
  assert.throws(()=>parseHeartRate([] as unknown as Uint8Array),errorCode('packet'));
});

test('detached buffers reject with the bounded packet error',()=>{
  const buffer=new ArrayBuffer(2);
  const view=new DataView(buffer);
  structuredClone(buffer,{transfer:[buffer]});
  assert.throws(()=>parseHeartRate(view),errorCode('packet'));
});

test('five actual spaced readings produce a detached arithmetic mean',()=>{
  const collection = ready(100);
  const snapshot = collection.snapshot(4100);
  assert.equal(snapshot.state,'ready'); assert.equal(snapshot.count,5);
  assert.deepEqual(snapshot.result,{connectionId:1,startedAtMs:100,completedAtMs:4100,baseline:70,
    samples:[68,69,70,71,72].map((bpm,i)=>({bpm,sequence:i+1,receivedAtMs:100+i*1000}))});
  snapshot.result!.baseline=0;
  snapshot.result!.samples[0]!.bpm=0;
  delete snapshot.result!.samples[1];
  assert.equal(collection.snapshot(4100).result!.baseline,70);
  assert.equal(collection.snapshot(4100).result!.samples[0]!.bpm,68);
  assert.ok(Object.hasOwn(collection.snapshot(4100).result!.samples,1));
});

test('bursts, duplicate sequence and ineligible BPM do not count or roll samples',()=>{
  const collection = new HeartRateCalibration(1,0);
  assert.equal(collection.observe(notification(1,0)),true);
  assert.equal(collection.observe(notification(2,999)),false);
  assert.equal(collection.observe(notification(2,1000)),false);
  assert.equal(collection.observe(notification(3,1000,39)),false);
  assert.equal(collection.observe(notification(4,1000,121)),false);
  assert.equal(collection.observe(notification(5,1000,70.5)),false);
  assert.equal(collection.observe(notification(6,1000,NaN)),false);
  assert.equal(collection.observe(notification(7,1000,70,'unknown')),true);
  for(let i=0;i<3;i++) assert.equal(collection.observe(notification(8+i,2000+i*1000)),true);
  assert.equal(collection.snapshot(4000).count,5);
  assert.equal(collection.observe(notification(11,5000,99)),false);
  assert.equal(collection.snapshot(5000).result!.completedAtMs,4000);
});

test('accepted readings consume their sequence and rejected readings consume observation watermarks',()=>{
  const collection = new HeartRateCalibration(1,0);
  assert.equal(collection.observe(notification(10,1000,0)),false);
  assert.equal(collection.observe(notification(9,NaN,70,'not-detected')),false);
  assert.throws(()=>collection.observe(notification(11,999)),errorCode('clock'));
  assert.equal(collection.observe(notification(11,1000)),true);
  assert.equal(collection.snapshot(1000).count,1);
});

test('constructor and applicable sequences validate safe generation IDs',()=>{
  for(const id of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>new HeartRateCalibration(id,0),errorCode('calibration'));
  for(const time of [-1,NaN,Infinity]) assert.throws(()=>new HeartRateCalibration(1,time),errorCode('clock'));
  const collection = new HeartRateCalibration(Number.MAX_SAFE_INTEGER,0);
  for(const sequence of [0,-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>collection.observe(notification(sequence,0,70,'unknown',Number.MAX_SAFE_INTEGER)),errorCode('calibration'));
  }
  assert.equal(collection.observe(notification(Number.MAX_SAFE_INTEGER,0,70,'unknown',Number.MAX_SAFE_INTEGER)),true);
});

test('wrong connection and old sequence cannot invalidate or advance clock',()=>{
  const collection = ready();
  assert.equal(collection.observe(notification(100,NaN,0,'not-detected',2)),false);
  assert.equal(collection.observe(notification(100,1e9,0,'not-detected',2)),false);
  assert.equal(collection.observe(notification(5,NaN,0,'not-detected')),false);
  assert.equal(collection.snapshot(4000).state,'ready');
});

test('observe and snapshot share one monotonic clock and clock errors leave sequences reusable',()=>{
  const collection = new HeartRateCalibration(1,100);
  collection.snapshot(5000);
  for(const time of [4999,-1,NaN,Infinity]) assert.throws(()=>collection.observe(notification(1,time,0,'not-detected')),errorCode('clock'));
  assert.equal(collection.observe(notification(1,5000)),true);
  for(const time of [4999,-1,NaN,Infinity]) assert.throws(()=>collection.snapshot(time),errorCode('clock'));
  assert.equal(collection.snapshot(5000).count,1);
  assert.equal(collection.observe(notification(2,5000)),false);
  assert.equal(collection.observe(notification(3,6000)),true);
});

test('contact loss invalidates collecting before BPM bounds and spacing',()=>{
  const collection = new HeartRateCalibration(1,0);
  collection.observe(notification(1,0));
  assert.equal(collection.observe(notification(2,1,0,'not-detected')),false);
  assert.deepEqual(collection.snapshot(1),{state:'invalidated',count:0,result:null});
  for(let i=0;i<5;i++) assert.equal(collection.observe(notification(3+i,1000+i*1000)),false);
  assert.equal(collection.snapshot(5000).state,'invalidated');
});

test('contact loss invalidates a ready result even during a burst',()=>{
  const collection = ready();
  assert.equal(collection.observe(notification(6,4000,65535,'not-detected')),false);
  assert.deepEqual(collection.snapshot(4000),{state:'invalidated',count:0,result:null});
});

test('collection window is inclusive and expiration retains accepted count',()=>{
  const collection = new HeartRateCalibration(1,0);
  for(let i=0;i<4;i++) collection.observe(notification(i+1,26000+i*1000));
  assert.equal(collection.snapshot(30000).state,'collecting');
  assert.equal(collection.observe(notification(5,30000)),true);
  assert.equal(collection.snapshot(30000).state,'ready');
  const expired = new HeartRateCalibration(1,0);
  expired.observe(notification(1,0));
  assert.equal(expired.observe(notification(2,30000.001)),false);
  assert.deepEqual(expired.snapshot(30000.001),{state:'expired',count:1,result:null});
  assert.equal(expired.observe(notification(3,31000)),false);
});

test('spread at 12 BPM is valid; excessive spread fails without rolling replacement',()=>{
  const success = new HeartRateCalibration(1,0);
  [40,52,40,52,40].forEach((bpm,i)=>assert.equal(success.observe(notification(i+1,i*1000,bpm)),true));
  assert.equal(success.snapshot(4000).result!.baseline,44.8);
  const failed = new HeartRateCalibration(1,0);
  [40,53,40,40,40].forEach((bpm,i)=>assert.equal(failed.observe(notification(i+1,i*1000,bpm)),true));
  assert.deepEqual(failed.snapshot(4000),{state:'failed',count:5,result:null});
  for(let i=0;i<5;i++) assert.equal(failed.observe(notification(6+i,5000+i*1000)),false);
  assert.equal(failed.snapshot(9000).count,5);
});

test('ready freshness is inclusive, expires permanently and cannot refresh through packets',()=>{
  const collection = ready();
  assert.equal(collection.observe(notification(6,13000)),false);
  assert.equal(collection.snapshot(14000).state,'ready');
  assert.deepEqual(collection.snapshot(14000.001),{state:'expired',count:5,result:null});
  assert.equal(collection.observe(notification(7,15000)),false);
  assert.equal(collection.snapshot(15000).result,null);
});

test('explicit invalidation is irreversible for collecting, ready, failed and expired',()=>{
  const failed=new HeartRateCalibration(1,0);
  [40,53,40,40,40].forEach((bpm,i)=>failed.observe(notification(i+1,i*1000,bpm)));
  const expired=new HeartRateCalibration(1,0);
  expired.snapshot(30001);
  for(const collection of [new HeartRateCalibration(1,0),ready(),failed,expired]) {
    collection.invalidate(); collection.invalidate();
    assert.deepEqual(collection.snapshot(30001),{state:'invalidated',count:0,result:null});
    assert.equal(collection.observe(notification(10,31000)),false);
    assert.equal(collection.snapshot(31000).count,0);
  }
});

test('fractional receipt times and inclusive BPM bounds are not rounded or quantized',()=>{
  for(const bpm of [40,120]) {
    const collection=new HeartRateCalibration(1,.25);
    for(let i=0;i<5;i++) {
      const incoming=notification(i+1,.25+i*1000,bpm);
      assert.equal(collection.observe(incoming),true);
      incoming.measurement.bpm=0; incoming.sequence=99; incoming.receivedAtMs=99999;
    }
    const result=collection.snapshot(14000.25).result!;
    assert.equal(result.baseline,bpm);
    assert.equal(result.samples[0]!.receivedAtMs,.25);
    assert.equal(result.completedAtMs,4000.25);
    assert.equal(collection.snapshot(14000.250001).state,'expired');
  }
});
