// Independent expectations authored from the frozen #61 contract and literal
// Heart Rate Measurement bytes, before reading any BLE producer implementation.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HeartRateCalibration, HeartRateError, parseHeartRate,
  type CalibrationResult, type HeartRateNotification,
} from '../src/heart-rate.ts';
import {
  advance, invalidateBluetooth, newRun, pause, resume, runReport,
  sample, sampleBluetooth, type Controls,
} from '../src/model.ts';

const still:Controls={x:0,y:0,interact:false,steady:false};
function notification(receivedAtMs:number, sequence:number, bpm=70,
  contact:'unknown'|'detected'|'not-detected'='unknown', connectionId=1):HeartRateNotification {
  return {connectionId,sequence,receivedAtMs,measurement:{bpm,contact,energyPresent:false,rrCount:0}};
}
function originCalibration():CalibrationResult {
  return {connectionId:1,startedAtMs:0,completedAtMs:4000,baseline:70,
    samples:[68,69,70,71,72].map((bpm,index)=>({bpm,sequence:index+1,receivedAtMs:index*1000}))};
}
function liveRun() {
  return newRun(70,false,{source:'bluetooth-hr',calibration:originCalibration(),startedAtMs:5000});
}
function readyCalibration() {
  const collector=new HeartRateCalibration(1,0);
  for(let index=0;index<5;index++)assert.equal(collector.observe(notification(index*1000,index+1,68+index)),true);
  return collector;
}
function packetError(bytes:number[]) {
  assert.throws(()=>parseHeartRate(Uint8Array.from(bytes)),
    (error:unknown)=>error instanceof HeartRateError&&error.code==='packet');
}

test('independent packet oracle: literal contact flags distinguish unsupported from supported loss',()=>{
  const cases:[number,'unknown'|'detected'|'not-detected'][]=[[0,'unknown'],[2,'unknown'],[4,'not-detected'],[6,'detected']];
  for(const [flag,contact] of cases)assert.deepEqual(parseHeartRate(Uint8Array.of(flag,73)),
    {bpm:73,contact,energyPresent:false,rrCount:0});
  assert.deepEqual(parseHeartRate(Uint8Array.of(1,0x34,0x12)),
    {bpm:4660,contact:'unknown',energyPresent:false,rrCount:0});
  assert.equal(parseHeartRate(Uint8Array.of(0,0)).bpm,0);
  assert.equal(parseHeartRate(Uint8Array.of(1,255,255)).bpm,65535);
});

test('independent packet oracle: offset views and little-endian optional fields have exact extents',()=>{
  const backing=Uint8Array.of(255,255,0x1f,0x34,0x12,0xaa,0xbb,0x00,0x04,0x00,0x08,255);
  const expected={bpm:4660,contact:'detected',energyPresent:true,rrCount:2};
  assert.deepEqual(parseHeartRate(new DataView(backing.buffer,2,9)),expected);
  assert.deepEqual(parseHeartRate(backing.subarray(2,11)),expected);
  assert.deepEqual(parseHeartRate(Uint8Array.of(8,70,0,0)),
    {bpm:70,contact:'unknown',energyPresent:true,rrCount:0});
  assert.deepEqual(parseHeartRate(Uint8Array.of(16,70,0,4)),
    {bpm:70,contact:'unknown',energyPresent:false,rrCount:1});
});

test('independent packet oracle: malformed lengths, reserved flags and payload ceiling reject',()=>{
  for(const bytes of [[],[0],[1,70],[0,70,0],[8,70],[8,70,0],
    [16,70],[16,70,0],[16,70,0,4,0],[24,70,0,0],
    [32,70],[64,70],[128,70]])packetError(bytes);
  // A two-byte UINT8 header plus 255 complete RR intervals is exactly512 bytes.
  const largest=new Uint8Array(512);largest[0]=16;largest[1]=70;
  assert.equal(parseHeartRate(largest).rrCount,255);
  const oversized=new Uint8Array(514);oversized[0]=16;oversized[1]=70;
  assert.throws(()=>parseHeartRate(oversized));
  assert.equal(largest.byteLength,512);
});

test('independent calibration oracle: five actual spaced samples average70 and snapshots are detached',()=>{
  const collector=readyCalibration();
  const first=collector.snapshot(4000);
  assert.equal(first.state,'ready');assert.equal(first.count,5);
  assert.deepEqual(first.result,originCalibration());
  if(first.result)first.result.samples[0].bpm=120;
  assert.equal(collector.snapshot(4000).result?.samples[0].bpm,68);
});

test('independent calibration oracle: bursts and duplicates cannot manufacture five samples',()=>{
  const collector=new HeartRateCalibration(1,0);
  assert.equal(collector.observe(notification(0,1)),true);
  for(let sequence=2;sequence<=9;sequence++)assert.equal(collector.observe(notification(sequence,sequence)),false);
  assert.equal(collector.snapshot(9).count,1);
  assert.equal(collector.observe(notification(1000,9)),false);
  assert.equal(collector.observe(notification(1000,10)),true);
  assert.equal(collector.snapshot(1000).count,2);
});

test('independent calibration oracle: exact window and readiness age boundaries are inclusive',()=>{
  const collector=new HeartRateCalibration(1,0);
  for(let index=0;index<5;index++)assert.equal(collector.observe(notification(26000+index*1000,index+1)),true);
  assert.equal(collector.snapshot(30000).state,'ready');
  assert.equal(collector.snapshot(40000).state,'ready');
  assert.equal(collector.snapshot(40000.001).state,'expired');
  assert.equal(collector.snapshot(40000.001).result,null);
  const expired=new HeartRateCalibration(1,0);
  assert.equal(expired.snapshot(30000).state,'collecting');
  assert.equal(expired.snapshot(30000.001).state,'expired');
});

test('independent calibration oracle: clock floor is shared and wrong identity/duplicates precede clocks',()=>{
  const collector=new HeartRateCalibration(1,0);
  assert.equal(collector.observe(notification(0,1)),true);
  collector.snapshot(5000);
  assert.equal(collector.observe(notification(Number.NaN,2,70,'not-detected',2)),false);
  assert.equal(collector.observe(notification(Number.NaN,1)),false);
  assert.throws(()=>collector.observe(notification(4000,2)),
    (error:unknown)=>error instanceof HeartRateError&&error.code==='clock');
  assert.equal(collector.snapshot(5000).count,1);
  assert.equal(collector.observe(notification(5000,2)),true);
  assert.throws(()=>collector.snapshot(4999));
  assert.equal(collector.snapshot(5000).count,2);
});

test('independent calibration oracle: contact loss invalidates ready and burst collection before BPM filtering',()=>{
  const ready=readyCalibration();
  assert.equal(ready.observe(notification(4001,6,0,'not-detected')),false);
  assert.deepEqual(ready.snapshot(4001),{state:'invalidated',count:0,result:null});
  assert.equal(ready.observe(notification(5000,7)),false);
  const collecting=new HeartRateCalibration(1,0);
  collecting.observe(notification(0,1));
  collecting.observe(notification(1,2,0,'not-detected'));
  assert.deepEqual(collecting.snapshot(1),{state:'invalidated',count:0,result:null});
});

test('independent calibration oracle: spread failure requires recollection and gameplay-only BPM cannot count',()=>{
  const collector=new HeartRateCalibration(1,0);
  for(let index=0;index<5;index++)collector.observe(notification(index*1000,index+1,[60,60,60,60,73][index]));
  assert.equal(collector.snapshot(4000).state,'failed');
  assert.equal(collector.snapshot(4000).result,null);
  const narrow=new HeartRateCalibration(1,0);
  for(const [index,bpm] of [0,35,39,121,220,65535].entries())assert.equal(narrow.observe(notification(index*1000,index+1,bpm)),false);
  assert.equal(narrow.snapshot(5000).count,0);
});

test('independent model oracle: BLE starts empty, pins detached immutable origin and refuses simulator samples',()=>{
  const calibration=originCalibration();
  const run=newRun(70,false,{source:'bluetooth-hr',calibration,startedAtMs:5000});
  assert.equal(run.source,'bluetooth-hr');assert.equal(run.sensor,'missing');
  assert.deepEqual(run.samples,[]);assert.equal(sample(run,200),false);
  calibration.samples[0].bpm=100;
  assert.equal(run.calibration?.samples[0].bpm,68);
  assert.equal(Reflect.set(run,'baseline',90),false);
  assert.equal(Reflect.set(run,'source','simulated'),false);
  assert.equal(run.baseline,70);
  assert.equal(sampleBluetooth(run,notification(6000,5)),false);
  assert.equal(sampleBluetooth(run,notification(6000,6)),true);
  assert.equal(run.samples.length,1);
});

test('independent model oracle: BLE freshness uses10000 receipt milliseconds rather than active seconds',()=>{
  const run=liveRun();sampleBluetooth(run,notification(6000,6,100));
  advance(run,.02,still,16000);assert.equal(run.sensor,'fresh');
  advance(run,.02,still,16000.001);assert.equal(run.sensor,'stale');
  assert.ok(run.time<.05);assert.equal(run.samples.length,1);
  assert.equal(run.samples[0].bpm,100);
});

test('independent model oracle: every model clock operation shares floor before any mutation',()=>{
  const run=liveRun();sampleBluetooth(run,notification(6000,6));
  advance(run,0,still,7000);
  const before=JSON.stringify(run);
  assert.equal(sampleBluetooth(run,notification(Number.NaN,7,0,'not-detected',2)),false);
  assert.equal(sampleBluetooth(run,notification(Number.NaN,6)),false);
  assert.equal(JSON.stringify(run),before);
  assert.throws(()=>sampleBluetooth(run,notification(6500,7)));
  assert.throws(()=>advance(run,.001,still,6999));
  assert.throws(()=>advance(run,.001,still,Number.NaN));
  assert.equal(JSON.stringify(run),before);
  assert.equal(sampleBluetooth(run,notification(8000,7)),true);
  assert.equal(sampleBluetooth(run,notification(8001,8)),false);
  assert.equal(sampleBluetooth(run,notification(9000,8)),false);
  assert.equal(sampleBluetooth(run,notification(9000,9)),true);
});

test('independent model oracle: contact loss invalidates within throttling window without deleting evidence',()=>{
  const run=liveRun();sampleBluetooth(run,notification(6000,6,100));
  assert.equal(sampleBluetooth(run,notification(6001,7,0,'not-detected')),false);
  assert.notEqual(run.sensor,'fresh');assert.equal(run.samples.length,1);
  advance(run,.02,still,6001);assert.equal(run.tension,0);
  assert.equal(run.samples[0].bpm,100);
  assert.equal(sampleBluetooth(run,notification(7001,7)),false);
  assert.equal(sampleBluetooth(run,notification(7001,8)),true);
  invalidateBluetooth(run,'disconnected');
  assert.notEqual(run.sensor,'fresh');assert.equal(run.samples.length,2);
  assert.equal(sampleBluetooth(run,notification(8001,9,70,'unknown',2)),false);
});

test('independent model oracle: paused packets cannot be replayed after resume or resurrect old reading',()=>{
  const run=liveRun();sampleBluetooth(run,notification(6000,6,100));pause(run);
  assert.equal(sampleBluetooth(run,notification(7000,7)),false);
  resume(run,8000);advance(run,.02,still,8000);
  assert.notEqual(run.sensor,'fresh');assert.equal(run.samples.length,1);
  assert.equal(run.tension,0);assert.equal(run.samples[0].bpm,100);
  assert.equal(sampleBluetooth(run,notification(8000,8)),false);
  assert.equal(sampleBluetooth(run,notification(8001,9)),true);
  assert.equal(run.samples.length,2);
  assert.throws(()=>resume(run,7999));
});

test('independent report oracle: live provenance has relative receipts and simulator keeps schema1',()=>{
  const run=liveRun();sampleBluetooth(run,notification(6000,6,75));
  const report=runReport(run);
  assert.equal(report.schemaVersion,2);assert.equal(report.source,'bluetooth-hr');
  assert.equal(report.samples[0].time,0);assert.equal(report.samples[0].bpm,75);
  assert.equal((report.samples[0] as {receivedSeconds?:number}).receivedSeconds,6);
  const calibration=(report as unknown as {calibration:{baselineBpm:number;samples:{bpm:number;receivedSeconds:number}[];spanSeconds:number;runStartedSeconds:number}}).calibration;
  assert.deepEqual(calibration,{baselineBpm:70,samples:[
    {bpm:68,receivedSeconds:0},{bpm:69,receivedSeconds:1},{bpm:70,receivedSeconds:2},
    {bpm:71,receivedSeconds:3},{bpm:72,receivedSeconds:4}],spanSeconds:4,runStartedSeconds:5});
  assert.doesNotMatch(JSON.stringify(report),/connectionId|receivedAtMs|startedAtMs|completedAtMs/);
  report.samples[0].bpm=200;assert.equal(run.samples[0].bpm,75);
  const simulated=newRun(70,false);sample(simulated,75);
  const old=runReport(simulated);
  assert.equal(old.schemaVersion,1);assert.equal(old.source,'simulated');
  assert.deepEqual(old.samples,[{time:0,bpm:75}]);assert.equal('calibration' in old,false);
});
