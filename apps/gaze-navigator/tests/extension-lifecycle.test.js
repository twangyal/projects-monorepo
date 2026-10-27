import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
// Control messages come from Gaze Navigator's own popup page.
const POPUP={url:'chrome-extension://test/popup.html'};
import vm from 'node:vm';

// Execute the shipped entry/content modules with only the DOM runtime replaced.
// Real ESM caching is essential: replacing import with a fresh function misses this regression.
async function contentHarness(run){
 const directory=await mkdtemp(join(tmpdir(),'gaze-entry-'));
 const saved=Object.fromEntries(['window','chrome','__gazeNavigatorRunning','__gazeNavigatorStop','__gazeNavigatorOwner','__gazeNavigatorReady','__gazeNavigatorError','__gazeNavigatorStart'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 let starts=0,stops=0,hold=null;
 globalThis.window={start:()=>{starts++;return{stop(){stops++;}}}};
 globalThis.chrome={runtime:{getURL:()=>pathToFileURL(join(directory,'entry.mjs')).href},storage:{session:{get:async()=>{if(hold)await hold;return{};},set:async()=>{},remove:async()=>{}}}};
 await writeFile(join(directory,'entry.mjs'),await readFile('src/web/extension-boot.js','utf8'));
 await writeFile(join(directory,'frame-speech.js'),'export const createFrameSpeech = () => ({});');
 await writeFile(join(directory,'frame-camera.js'),'export const createFrameCamera = () => ({});');await writeFile(join(directory,'overlay.js'),'export const startWebNavigator = ({window}) => window.start();');
 await writeFile(join(directory,'package.json'),'{"type":"module"}');
 const script=new vm.Script(await readFile('extension/content.js','utf8'),{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
 const tick=()=>new Promise(r=>setTimeout(r,10));
 const until=async predicate=>{for(let n=0;n<50&&!predicate();n++)await tick();assert.ok(predicate(),'startup completed');};
 try{await run({start:()=>script.runInThisContext(),stop:()=>globalThis.__gazeNavigatorStop?.(),until,tick,get starts(){return starts;},get stops(){return stops;},hold(p){hold=p;}});}
 finally{globalThis.__gazeNavigatorStop?.();for(const[k,descriptor]of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,k,descriptor);else delete globalThis[k];}await rm(directory,{recursive:true,force:true});}
}

test('same-page content restart starts the real cached entry afresh without duplicate overlays',async()=>{
 await contentHarness(async h=>{
  h.start();await h.until(()=>h.starts===1);h.start();await h.tick();assert.equal(h.starts,1);
  h.stop();assert.equal(h.stops,1);h.start();await h.until(()=>h.starts===2);h.stop();assert.equal(h.stops,2);
 });
});

test('stopping during entry storage load prevents a late navigator and a newer start still works',async()=>{
 await contentHarness(async h=>{
  let release;h.hold(new Promise(r=>{release=r;}));h.start();await h.tick();h.stop();release();
  await h.tick();await h.tick();assert.equal(h.starts,0,'stopped startup never creates a navigator');
  h.hold(null);h.start();await h.until(()=>h.starts===1);assert.equal(globalThis.__gazeNavigatorRunning,true);
 });
});

test('background status probes the current page instead of remembered continuation intent',async()=>{
 let listener,probes=0;
 const chrome={runtime:{getURL:p=>'chrome-extension://test/'+p,onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}},
  storage:{session:{setAccessLevel:async()=>{},get:async()=>({enabledTabs:{7:true}})}},
  commands:{onCommand:{addListener(){}}},tabs:{onUpdated:{addListener(){}},onRemoved:{addListener(){}}},
  action:{setBadgeText:async()=>{},setTitle:async()=>{}},
  scripting:{executeScript:async()=>{probes++;return[{result:{on:false,phase:'off',message:''}}];}}};
 vm.runInNewContext(await readFile('extension/background.js','utf8'),{chrome,console});
 const status=await new Promise(resolve=>listener({type:'gaze:status',tabId:7},POPUP,resolve));
 assert.equal(status.on,false);assert.equal(probes,1);
});

test('an old navigation decision cannot restart after a newer explicit Stop',async()=>{
 let listener,onUpdated,releasePreferences,enabled={7:true};
 const world={console,__gazeNavigatorRunning:true};world.__gazeNavigatorStop=()=>{world.__gazeNavigatorRunning=false;};
 const chrome={runtime:{getURL:p=>'chrome-extension://test/'+p,onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}},
  storage:{session:{setAccessLevel:async()=>{},get:async()=>({enabledTabs:structuredClone(enabled)}),set:async value=>{enabled=value.enabledTabs;}},local:{get:()=>new Promise(resolve=>{releasePreferences=resolve;})}},
  permissions:{contains:async()=>true},commands:{onCommand:{addListener(){}}},tabs:{onUpdated:{addListener(fn){onUpdated=fn;}},onRemoved:{addListener(){}}},
  action:{setBadgeText:async()=>{},setTitle:async()=>{}},
  scripting:{executeScript:async spec=>{if(spec.files){world.__gazeNavigatorRunning=true;return[];}return[{result:await spec.func(...(spec.args??[]))}];}}};world.chrome=chrome;
 vm.runInNewContext(await readFile('extension/background.js','utf8'),world);
 const navigation=onUpdated(7,{status:'complete'},{url:'https://example.test/'});
 await new Promise(r=>setImmediate(r));assert.equal(typeof releasePreferences,'function');
 assert.equal(await new Promise(resolve=>listener({type:'gaze:stop',tabId:7},POPUP,resolve)),'off');
 assert.equal(world.__gazeNavigatorRunning,false);
 releasePreferences({preferences:{persist:true,autoStart:false}});await navigation;
 assert.equal(world.__gazeNavigatorRunning,false,'old continuation decision stays retired');assert.deepEqual(enabled,{});
});

for(const outcome of ['resolve','reject'])test(`a newer start survives the old startup's late ${outcome}`,async()=>{
 await contentHarness(async h=>{
  let resolve,reject;h.hold(new Promise((ok,no)=>{resolve=ok;reject=no;}));h.start();await h.tick();const old=globalThis.__gazeNavigatorStart;
  h.stop();h.hold(null);h.start();await h.until(()=>h.starts===1);
  if(outcome==='resolve')resolve();else reject(Error('old native read failed'));
  await old;assert.equal(h.starts,1);assert.equal(h.stops,0);assert.equal(globalThis.__gazeNavigatorRunning,true);assert.equal(globalThis.__gazeNavigatorReady,true);
  h.stop();assert.equal(h.stops,1);
 });
});

for(const sequence of [['toggle','toggle'],['stop','toggle']])test(`explicit ${sequence.join(' then ')} preserves request order`,async()=>{
 let listener,enabled={};const world={console,__gazeNavigatorRunning:sequence[0]==='stop'};
 world.__gazeNavigatorStop=()=>{world.__gazeNavigatorRunning=false;};
 const chrome={runtime:{getURL:p=>'chrome-extension://test/'+p,onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}},
 storage:{session:{setAccessLevel:async()=>{},get:async()=>({enabledTabs:structuredClone(enabled)}),set:async value=>{enabled=value.enabledTabs;}},local:{get:async()=>({})}},permissions:{contains:async()=>true},
 commands:{onCommand:{addListener(){}}},tabs:{onUpdated:{addListener(){}},onRemoved:{addListener(){}}},action:{setBadgeText:async()=>{},setTitle:async()=>{}},
 scripting:{executeScript:async spec=>{if(spec.files){world.__gazeNavigatorRunning=true;return[];}return[{result:await spec.func(...(spec.args??[]))}];}}};world.chrome=chrome;
 vm.runInNewContext(await readFile('extension/background.js','utf8'),world);
 const responses=await Promise.all(sequence.map(mode=>new Promise(resolve=>listener({type:`gaze:${mode}`,tabId:7},POPUP,resolve))));
 assert.deepEqual(responses,sequence[0]==='toggle'?['on','off']:['off','on']);assert.equal(world.__gazeNavigatorRunning,sequence[0]==='stop');
});

test('a content script inside a website cannot turn the navigator on or off or read its status', async () => {
  let listener, scripted = 0;
  const chrome = { runtime: { getURL: p => 'chrome-extension://test/' + p, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
    storage: { session: { setAccessLevel: async () => {}, get: async () => ({}) } },
    commands: { onCommand: { addListener() {} } }, tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} } },
    action: { setBadgeText: async () => {}, setTitle: async () => {} },
    scripting: { executeScript: async () => { scripted++; return [{ result: 'stop' }]; } } };
  vm.runInNewContext(await readFile('extension/background.js', 'utf8'), { chrome, console });
  const website = { url: 'https://example.com/page', tab: { id: 7 }, frameId: 0 };
  for (const type of ['gaze:toggle', 'gaze:start', 'gaze:stop', 'gaze:status', 'gaze:page-status']) {
    let answered = false;
    assert.equal(listener({ type, tabId: 7 }, website, () => { answered = true; }), false, type);
    assert.equal(answered, false, type);
  }
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(scripted, 0);
});
