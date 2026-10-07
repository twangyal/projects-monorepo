import test from 'node:test';
import assert from 'node:assert/strict';
import {instrumentStages} from '../scripts/stage-timing-diagnostics.mjs';

test('stage observers preserve receiver, native promise identity and errors',async()=>{
 let now=0,resolve;
 const promise=new Promise(r=>{resolve=r;});
 const encoder={video(){now+=3;return 'sample';},addVideo(){assert.equal(this,encoder);return promise;},cancel(){throw Error('native refusal');}};
 const backend={create(){assert.equal(this,backend);return encoder;},probe(){return 'vp9';}};
 const renderer={draw(){assert.equal(this,renderer);now+=5;return 'drawn';}};
 const original={create:backend.create,probe:backend.probe,draw:renderer.draw};
 const timer=instrumentStages(backend,renderer,()=>now);
 assert.equal(renderer.draw(),'drawn');
 assert.equal(backend.probe(),'vp9');
 const wrapped=backend.create();assert.equal(wrapped,encoder);assert.equal(wrapped.video(),'sample');
 assert.equal(wrapped.addVideo(),promise);now+=20;
 assert.equal(timer.snapshot().stages.addVideo.pending,1);
 assert.equal(timer.snapshot().stages.addVideo.pendingMs,20);
 resolve();await promise;
 assert.throws(()=>wrapped.cancel(),/native refusal/);
 const report=timer.snapshot();
 assert.deepEqual(report.stages.draw,{calls:1,completed:1,errors:0,totalMs:5,maxMs:5,pending:0,pendingMs:0});
 assert.equal(report.stages.video.totalMs,3);assert.equal(report.stages.addVideo.totalMs,20);
 assert.equal(report.stages.cancel.errors,1);
 timer.stop();assert.equal(backend.create,original.create);assert.equal(backend.probe,original.probe);assert.equal(renderer.draw,original.draw);
 wrapped.video();assert.equal(timer.snapshot().stages.video.calls,1,'retired native delegates do not add observations');
});

test('rejected native promises stay rejected, snapshots detach, and observation storage stays fixed',async()=>{
 const failure=Promise.reject(Error('native encode failure'));failure.catch(()=>{});
 const backend={probe(){return failure;},create(){return {};}};
 const timer=instrumentStages(backend,{draw(){}},()=>0);
 assert.equal(backend.probe(),failure);await assert.rejects(failure,/native encode failure/);
 const first=timer.snapshot();first.stages.probe.calls=900;
 assert.equal(timer.snapshot().stages.probe.calls,1);
 assert.equal(timer.snapshot().stages.probe.errors,1);
 for(let i=0;i<10000;i++)backend.create();
 assert.equal(Object.keys(timer.snapshot().stages).length,10);
 assert.equal(timer.snapshot().stages.create.calls,10000);
 timer.stop();
});
