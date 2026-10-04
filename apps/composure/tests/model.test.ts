import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/model.ts';

test('calibration requires five bounded consistent simulated readings', () => {
  assert.equal(typeof game.calibrate, 'function');
  assert.equal(game.calibrate([68, 70, 72, 70, 70]), 70);
  for (const readings of [[], [70], [30,70,70,70,70], [70,70,70,70,130], [50,70,70,70,70], [NaN,70,70,70,70]]) assert.throws(() => game.calibrate(readings));
});

test('sample freshness, tension bounds, invalid rejection and pause use active time', () => {
  assert.equal(typeof game.newRun, 'function');
  const run = game.newRun(70, false);
  assert.equal(run.sensor, 'missing');
  assert.equal(game.sample(run, NaN), false); assert.equal(game.sample(run, 221), false);
  assert.equal(game.sample(run, 140), true);
  for(let i=0;i<40;i++) game.advance(run, .25, {x:0,y:0,interact:false,steady:false});
  assert.ok(run.tension > .95 && run.tension <= 1); assert.equal(run.sensor, 'fresh');
  game.advance(run,.25,{x:0,y:0,interact:false,steady:false}); assert.equal(run.sensor,'stale');
  game.pause(run); const snapshot=JSON.stringify(run); game.advance(run,100,{x:1,y:0,interact:true,steady:false}); assert.equal(JSON.stringify(run),snapshot);
  game.resume(run); for(let i=0;i<60;i++) game.advance(run,.25,{x:0,y:0,interact:false,steady:false});
  assert.ok(run.tension < .01); assert.equal(run.sensor,'stale');
});

test('fixed simulation steps preserve movement at 30, 60 and 120 Hz and cap stalls', () => {
  assert.equal(typeof game.advance,'function');
  const positions=[30,60,120].map(hz=>{const run=game.newRun(70,false);for(let i=0;i<hz*2;i++) game.advance(run,1/hz,{x:1,y:0,interact:false,steady:false});return run.x;});
  assert.ok(positions.every(x=>Math.abs(x-340)<1e-6));
  const run=game.newRun(70,false);game.advance(run,100,{x:1,y:0,interact:false,steady:false});assert.ok(run.time<=.251); assert.ok(run.x<=113);
});

test('full escape needs fuse, power, key and a steady lock before exit', () => {
  assert.equal(typeof game.newRun,'function');
  const run=game.newRun(70,false), idle={x:0,y:0,interact:true,steady:true};
  run.x=1030;run.y=160;game.advance(run,.25,idle);assert.equal(run.unlocked,false);assert.equal(run.lock,0);
  for(const [x,y] of [[250,110],[520,230],[740,110]]){run.x=x;run.y=y;game.advance(run,.1,idle);}
  assert.equal(run.fuse,true);assert.equal(run.power,true);assert.equal(run.key,true);
  run.x=1030;run.y=160;for(let i=0;i<17;i++)game.advance(run,.25,idle);
  assert.equal(run.unlocked,true);run.x=1160;game.advance(run,.1,idle);assert.equal(run.phase,'won');
  const report=game.runReport(run);assert.equal(report.source,'simulated');assert.equal(report.outcome,'won');assert.ok(report.events.some(e=>e.kind==='win'));
  const snapshot=JSON.stringify(run);game.advance(run,1,idle);assert.equal(JSON.stringify(run),snapshot);
});

test('timer/noise can lose, reset is detached, and report streams are bounded', () => {
  assert.equal(typeof game.newRun,'function');
  const run=game.newRun(70,false);run.time=179.9;game.advance(run,.25,{x:0,y:0,interact:false,steady:false});assert.equal(run.phase,'lost');assert.equal(run.loss,'timeout');
  const noisy=game.newRun(70,false);noisy.noise=100;game.advance(noisy,.1,{x:0,y:0,interact:true,steady:false});assert.equal(noisy.phase,'lost');
  const fresh=game.newRun(70,false);assert.equal(fresh.time,0);assert.equal(fresh.fuse,false);
  for(let i=0;i<300;i++)game.sample(fresh,70+i%3);const report=game.runReport(fresh);assert.equal(report.samples.length,256);assert.ok(report.truncatedSamples);assert.ok(JSON.stringify(report).length<100000);
  report.samples[0]!.bpm=999;assert.notEqual(fresh.samples[0]!.bpm,999);
  assert.throws(()=>game.newRun(0,false));
});

test('steady has a real bounded aim and noise effect without altering the simulated source',()=>{
  const run=game.newRun(70,false);run.x=1030;run.y=160;run.time=.15;run.tension=1;
  const idle={x:0,y:0,interact:true,steady:false};const unstable=game.aimPoint(run,idle),stable=game.aimPoint(run,{...idle,steady:true});
  assert.ok(unstable.error>18&&unstable.error<38);assert.ok(stable.error<10);assert.ok(game.aimPoint(run,{...idle,aim:{x:0,y:0}}).error>100);
  const loud=game.newRun(70,false),quiet=game.newRun(70,false);game.sample(loud,220);game.sample(quiet,220);
  for(let i=0;i<8;i++){game.advance(loud,.25,{x:1,y:0,interact:false,steady:false});game.advance(quiet,.25,{x:1,y:0,interact:false,steady:true});}
  assert.ok(quiet.noise<loud.noise);assert.ok(quiet.x<loud.x);assert.equal(quiet.samples[0]!.bpm,220);
});

test('invalid frame inputs preserve the model and capped events keep the latest terminal report',()=>{
  const run=game.newRun(70,false),before=JSON.stringify(run),idle={x:0,y:0,interact:false,steady:false};
  for(const elapsed of [-1,NaN,Infinity])assert.throws(()=>game.advance(run,elapsed,idle));
  assert.throws(()=>game.advance(run,.1,{...idle,x:NaN}));assert.throws(()=>game.advance(run,.1,{...idle,aim:{x:Infinity,y:0}}));assert.equal(JSON.stringify(run),before);
  for(let i=0;i<140;i++){game.pause(run);game.resume(run);}
  run.noise=100;game.advance(run,.1,idle);const report=game.runReport(run);assert.equal(report.events.length,256);assert.equal(report.events.at(-1)!.kind,'loss');assert.equal(report.truncatedEvents,true);assert.equal(report.source,'simulated');
});
