import './style.css';
import {calibrate,newRun,sample,sampleBluetooth,invalidateBluetooth,advance,pause,resume,nearby,objects,aimPoint,runReport,WORLD,type Run,type RunEvent,type Controls} from './model.ts';
import {HeartRateCalibration,type CalibrationSnapshot,type HeartRateNotification} from './heart-rate.ts';
import {BluetoothHeartRate,type BluetoothProvider,type BluetoothSnapshot} from './bluetooth.ts';
import {loadSettings,saveSettings,defaults,SETTINGS_KEY,type Settings} from './settings.ts';

const root=document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML=`<main><header><p class="eyebrow">A SMALL OBSERVATORY / A LONG NIGHT</p><h1>Composure.</h1><p class="intro">Restore the lights. Find the key. Keep your hands steady long enough to open the exit. The watcher listens when you hurry.</p><span class="tag" id="source-tag">SIMULATOR AVAILABLE · OPTIONAL BLUETOOTH INPUT</span></header><div class="layout"><div><section class="stage" aria-label="Observatory escape game"><div class="stage-heading"><h2>The sealed corridor</h2><span id="phase">Ready to calibrate</span></div><div class="canvas-wrap"><canvas width="1200" height="320" tabindex="0" aria-label="Escape corridor. Use WASD or arrows to move, E to interact, Shift to steady. Pointer aiming is optional."></canvas></div><div class="dashboard"><div class="stat"><span>Active time remaining</span><strong id="timer">180 s</strong></div><div class="stat"><span id="sensor-label">Declared simulated reading</span><strong id="sensor">No sample</strong></div><div class="stat"><span>Game tension</span><strong id="tension">0%</strong><meter id="tension-meter" aria-label="Game tension" min="0" max="1" value="0"></meter></div><div class="stat"><span>Noise / watcher attention</span><strong id="noise">0 / 100</strong><meter id="noise-meter" aria-label="Watcher attention" min="0" max="100" value="0"></meter></div><div class="stat"><span>Lock progress</span><strong id="lock">0%</strong><progress id="lock-meter" aria-label="Exit lock progress" max="1" value="0"></progress></div><div class="stat"><span>Position / nearby object</span><strong id="position">80, 160</strong><span id="nearby">None</span></div></div><p id="run-source" class="run-source">Current run source: none</p><div class="controls"><button id="start" class="primary">Calibrate & start</button><button id="pause" disabled>Pause</button><button id="restart" disabled>Restart</button><button id="report" disabled>Download run report</button></div><div class="controls"><button id="interact" disabled>Hold to interact</button><button id="steady" aria-pressed="false" disabled>Steady: off</button><button id="keyboard-aim" aria-pressed="true">Keyboard aim</button></div><div class="touch" aria-label="Movement controls"><button class="up" data-move="up" aria-label="Move up">↑</button><button class="left" data-move="left" aria-label="Move left">←</button><button class="down" data-move="down" aria-label="Move down">↓</button><button class="right" data-move="right" aria-label="Move right">→</button></div><p id="message" class="message" role="status">Choose your simulated resting baseline, then calibrate and start.</p></section><p class="hint">WASD / arrows: move · E: hold to interact · Shift: steady and move quietly. Stand near an object; hold the lock for four steady seconds. Click the corridor to use pointer aim, or choose Keyboard aim. Touch players can use the arrows and interaction button.</p></div><aside class="side"><section class="signal-source"><h2>Choose your input</h2><label for="input-source">Next run source<select id="input-source"><option value="simulated">Simulator</option><option value="bluetooth-hr">Bluetooth heart-rate sensor</option></select></label><p class="hint">The current run keeps its original source. Changing this choice prepares another run.</p><div class="ble-controls"><button id="ble-connect">Connect heart-rate sensor</button><button id="ble-cancel" disabled>Cancel connection</button><button id="ble-disconnect" disabled>Disconnect sensor</button><button id="ble-calibrate" disabled>Collect baseline</button></div><p id="ble-status" aria-live="polite" class="hint">Checking Bluetooth browser support…</p><p id="ble-calibration" aria-live="polite" class="hint">Baseline: 0/5 received readings. Collect five stable readings before starting.</p><p class="hint">Requires a secure context and a compatible browser and standard Heart Rate sensor. Firefox, Safari/iOS and Android WebView are unsupported; Linux Chromium may need platform setup. The browser chooser requires your consent. Cancel retires this request but may leave the native chooser open.</p><p class="hint">Device compatibility and reading accuracy are unverified. Energy and RR data are ignored. This game does not infer emotion or health.</p></section><section><h2>Simulated signal</h2><fieldset id="simulator-controls"><legend class="sr-only">Simulator inputs</legend><label>Resting baseline <input id="baseline" type="number" min="40" max="120" step="1" value="70"> BPM</label><label>Current reading <input id="reading" type="range" min="35" max="220" step="1" value="70"></label><output id="reading-value">70 BPM (simulated)</output><label><input id="sampling" type="checkbox" checked> Send simulated reading each active second</label><button id="send">Send one simulated sample</button></fieldset><p class="hint" id="calibration">Calibration uses five declared simulated baseline values. It does not measure a person. Old or missing samples smoothly return the game to neutral after ten active seconds.</p></section><section><h2>Your route</h2><ol class="steps"><li id="goal-fuse">Take the fuse from the upper shelf (250, 110).</li><li id="goal-power">Restore the lower power panel (520, 230).</li><li id="goal-key">Take the key from the upper shelf (740, 110).</li><li id="goal-lock">Steady the exit lock (1030, 160), then reach the exit (1160, 160).</li></ol><p class="hint">Higher admitted readings slow movement, increase noise and shake aim. Steady reduces jitter and movement noise. Noise at 100 or 180 active seconds ends a run.</p></section><section><h2>Comfort & preferences</h2><label><input id="scares" type="checkbox" checked> One authored window scare</label><label><input id="reduced" type="checkbox"> Reduced visual motion</label><label><input id="muted" type="checkbox" checked> Mute optional sound</label><button id="save">Save preferences</button><p id="best" class="hint">No completed best time.</p><p id="storage-status" role="status"></p><button id="reset-settings" hidden>Reset unreadable preferences</button><p class="hint">Only simulator preferences and simulated best completion time save locally. All run samples/events stay in memory until you choose to download a report.</p></section></aside></div><footer>Original local prototype for project #17 · Simulator values are declared; Bluetooth values come from received standard heart-rate notifications. Neither establishes emotions or health. The browser connection flow is available; physical-device compatibility, measurement accuracy and watch verification remain unverified.</footer></main>`;
const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=document.querySelector<HTMLCanvasElement>('canvas')!,ctx=canvas.getContext('2d')!;
const baseline=get<HTMLInputElement>('baseline'),reading=get<HTMLInputElement>('reading'),scares=get<HTMLInputElement>('scares'),reduced=get<HTMLInputElement>('reduced'),muted=get<HTMLInputElement>('muted'),sampling=get<HTMLInputElement>('sampling');
let settings:Settings=defaults(),storageBlocked=false;
try {const loaded=loadSettings(localStorage);settings=loaded.value;storageBlocked=loaded.error;}catch{storageBlocked=true;}
if(matchMedia('(prefers-reduced-motion: reduce)').matches)settings.reducedMotion=true;
baseline.value=String(settings.baseline);reading.value=String(settings.baseline);scares.checked=settings.scares;reduced.checked=settings.reducedMotion;muted.checked=settings.muted;
function storageStatus(text:string):void {get('storage-status').textContent=text;get('reset-settings').hidden=!storageBlocked;get('best').textContent=settings.bestSeconds===null?'No completed best time.':`Best completed run: ${settings.bestSeconds.toFixed(1)} active seconds.`;}
storageStatus(storageBlocked?'Saved preferences could not be read. The raw record is kept; automatic saving is disabled.':'Preferences stay in this browser; run samples are not autosaved.');
const nextSource=get<HTMLSelectElement>('input-source');
let transport:BluetoothHeartRate|null=null;
let bluetoothState:BluetoothSnapshot={phase:'unavailable',connectionId:null,message:'Bluetooth is unavailable in this browser or context. The simulator remains available.'};
let calibration:HeartRateCalibration|null=null,calibrationConnection:number|null=null;
let startIntent=0,disposed=false;
let calibrationText='Baseline: 0/5 received readings. Collect five stable readings before starting.';
let run:Run|null=null,lastFrame=0,lastSample=-1,steadyToggle=false,pointerAim:{x:number;y:number}|undefined;
let audio:AudioContext|null=null;const keys=new Set<string>(),touch=new Map<number,string>(),interactPointers=new Set<number>();let lastEvent:RunEvent|null=null;
function release():void {keys.clear();touch.clear();interactPointers.clear();}
function controls():Controls {const values=new Set([...keys,...touch.values()]);return{x:Number(values.has('right')||values.has('d')||values.has('arrowright'))-Number(values.has('left')||values.has('a')||values.has('arrowleft')),y:Number(values.has('down')||values.has('s')||values.has('arrowdown'))-Number(values.has('up')||values.has('w')||values.has('arrowup')),interact:values.has('e')||interactPointers.size>0,steady:steadyToggle||values.has('shift'),aim:pointerAim};}
function announce(text:string):void {get('message').textContent=text;}
function save():void {if(storageBlocked){storageStatus('Saved preferences are unreadable. Reset them explicitly before saving; current run stays in memory.');return;}try{settings={schemaVersion:1,baseline:calibrate(Array(5).fill(Number(baseline.value)) as number[]),scares:scares.checked,reducedMotion:reduced.checked,muted:muted.checked,bestSeconds:settings.bestSeconds};saveSettings(localStorage,settings);storageStatus('Preferences saved locally. No simulated sample log was stored.');}catch{storageStatus('Preferences could not be saved. Current game stays usable in memory.');}}
function audioReady():void {if(muted.checked)return;try{audio??=new AudioContext();void audio.resume().catch(()=>{});}catch{announce('Optional sound is unavailable. The game remains playable.');}}
function sound():void {if(!audio||muted.checked)return;const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.type='sine';oscillator.frequency.value=110;gain.gain.setValueAtTime(.035,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.15);oscillator.connect(gain);gain.connect(audio.destination);oscillator.start();oscillator.stop(audio.currentTime+.15);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};}
function publishRun(candidate:Run):void {
  run=candidate;lastSample=-1;lastEvent=null;lastFrame=0;steadyToggle=false;pointerAim=undefined;release();
  if(run.source==='simulated'){
    transport?.disconnect();
    sample(run,Number(reading.value));lastSample=0;
    get('calibration').textContent=`Five declared simulated values calibrated baseline ${run.baseline} BPM. It remains fixed for this run.`;
  }
  audioReady();canvas.focus();render();
}
function start():void {
  const intent=startIntent;
  if(nextSource.value==='bluetooth-hr'){
    try{
      const result=readyBaseline();if(!result){announce('Connect and collect a fresh Bluetooth baseline before starting. Current run is kept.');return;}
      // Validate before asking to replace any old in-memory report.
      newRun(result.baseline,scares.checked,{source:'bluetooth-hr',calibration:result,startedAtMs:performance.now()});
      if(run&&!confirm('Start a new Bluetooth run and replace the current in-memory run report? Download its report first if you want to keep it.'))return;
      if(intent!==startIntent||nextSource.value!=='bluetooth-hr')return;
      const fresh=readyBaseline();if(!fresh||fresh.connectionId!==result.connectionId){announce('The Bluetooth baseline is no longer fresh. Collect baseline again. The previous run is kept.');render();return;}
      const candidate=newRun(fresh.baseline,scares.checked,{source:'bluetooth-hr',calibration:fresh,startedAtMs:performance.now()});
      clearCalibration(`Baseline used: ${fresh.baseline} BPM from 5/5 received readings. Collect a new baseline to start another Bluetooth run.`);
      publishRun(candidate);
    }catch{announce('Bluetooth calibration could not be used. Collect a fresh stable baseline; the previous run is kept.');refreshBluetooth();}
    return;
  }
  try{
    const calibrated=calibrate(Array(5).fill(Number(baseline.value)) as number[]),candidate=newRun(calibrated,scares.checked);
    if(run?.source==='bluetooth-hr'&&!confirm('Start a simulator run and replace the current Bluetooth run report? Download its report first if you want to keep it.'))return;
    if(intent!==startIntent||nextSource.value!=='simulated')return;
    clearCalibration();publishRun(candidate);
  }catch{announce('Use a simulated resting baseline from 40 to 120 BPM. Current work was kept.');}
}
get('start').addEventListener('click',start);
get('restart').addEventListener('click',()=>{
  if(run?.source==='bluetooth-hr'){
    nextSource.value='bluetooth-hr';clearCalibration();inactive();announce('Bluetooth restart needs new received values. Choose Collect baseline, then Start Bluetooth run. Your previous report is kept.');render();get('ble-calibrate').focus();
  }else{nextSource.value='simulated';clearCalibration();transport?.cancel();start();}
});
get('pause').addEventListener('click',()=>{if(!run)return;release();lastFrame=0;if(run.phase==='paused'){if(calibration)clearCalibration();resume(run,run.source==='bluetooth-hr'?performance.now():undefined);audioReady();canvas.focus();}else{pause(run);void audio?.suspend().catch(()=>{});}render();});
get('steady').addEventListener('click',()=>{steadyToggle=!steadyToggle;render();});
get('keyboard-aim').addEventListener('click',()=>{pointerAim=undefined;get('keyboard-aim').setAttribute('aria-pressed','true');});
get('send').addEventListener('click',()=>{if(run?.source==='simulated'&&sample(run,Number(reading.value))){lastSample=run.time;announce(`Accepted simulated ${reading.value} BPM at active ${run.time.toFixed(1)} seconds.`);}else announce('Start or resume a run before sending a bounded simulated sample.');render();});
reading.addEventListener('input',()=>{get('reading-value').textContent=`${reading.value} BPM (simulated)`;});get('reading-value').textContent=`${reading.value} BPM (simulated)`;
get('save').addEventListener('click',save);muted.addEventListener('change',()=>{if(muted.checked)void audio?.suspend().catch(()=>{});else audioReady();});
get('reset-settings').addEventListener('click',()=>{if(!confirm('Reset unreadable preferences and best time for this browser?'))return;try{localStorage.removeItem(SETTINGS_KEY);storageBlocked=false;settings=defaults();storageStatus('Unreadable preferences reset. Current in-memory run was kept.');}catch{storageStatus('Could not reset preferences. The saved record is kept.');}});
get('report').addEventListener('click',()=>{if(!run)return;const url=URL.createObjectURL(new Blob([JSON.stringify(runReport(run),null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=run.source==='bluetooth-hr'?'composure-bluetooth-hr-run.json':'composure-simulated-run.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
function inputField(target:EventTarget|null):boolean {return target instanceof HTMLInputElement||target instanceof HTMLSelectElement||target instanceof HTMLTextAreaElement||target instanceof HTMLElement&&target.isContentEditable;}
window.addEventListener('focusin',e=>{if(inputField(e.target))release();});
window.addEventListener('keydown',e=>{if(inputField(e.target)||!run||run.phase!=='running')return;const key=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','e','shift'].includes(key)){e.preventDefault();keys.add(key);}});
window.addEventListener('keyup',e=>{keys.delete(e.key.toLowerCase());});
function inactive():void {release();if(run?.phase==='running'){pause(run);lastFrame=0;void audio?.suspend().catch(()=>{});render();}}
window.addEventListener('blur',inactive);document.addEventListener('visibilitychange',()=>{if(document.hidden){inactive();clearCalibration();if(run?.source==='bluetooth-hr')invalidateBluetooth(run,'hidden');transport?.disconnect();refreshBluetooth();}});
window.addEventListener('pagehide',event=>{
  inactive();clearCalibration();
  // A cached page keeps this heap. Retain pending cleanup ownership so an
  // explicit connection after return cannot overlap an older native operation.
  if(event.persisted)transport?.disconnect();
  else{disposed=true;transport?.dispose();}
  void audio?.close().catch(()=>{});audio=null;refreshBluetooth();
});
window.addEventListener('pageshow',event=>{if(event.persisted){lastFrame=0;release();refreshBluetooth();}});
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-move]')){
  button.addEventListener('pointerdown',e=>{if(run?.phase!=='running')return;e.preventDefault();button.setPointerCapture(e.pointerId);touch.set(e.pointerId,button.dataset.move!);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,e=>touch.delete((e as PointerEvent).pointerId));
}
const interaction=get<HTMLButtonElement>('interact');interaction.addEventListener('pointerdown',e=>{if(run?.phase!=='running')return;e.preventDefault();interaction.setPointerCapture(e.pointerId);interactPointers.add(e.pointerId);});
for(const type of ['pointerup','pointercancel','lostpointercapture'])interaction.addEventListener(type,e=>{interactPointers.delete((e as PointerEvent).pointerId);});
interaction.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();keys.add('e');}});interaction.addEventListener('keyup',()=>keys.delete('e'));interaction.addEventListener('blur',()=>keys.delete('e'));
canvas.addEventListener('pointerdown',e=>{const rect=canvas.getBoundingClientRect();pointerAim={x:(e.clientX-rect.left)/rect.width*WORLD.width,y:(e.clientY-rect.top)/rect.height*WORLD.height};get('keyboard-aim').setAttribute('aria-pressed','false');canvas.focus();});
canvas.addEventListener('pointermove',e=>{if(!pointerAim)return;const rect=canvas.getBoundingClientRect();pointerAim={x:(e.clientX-rect.left)/rect.width*WORLD.width,y:(e.clientY-rect.top)/rect.height*WORLD.height};});
function draw():void {
  ctx.fillStyle='#0b1316';ctx.fillRect(0,0,1200,320);ctx.fillStyle='#223033';ctx.fillRect(15,25,1170,270);ctx.fillStyle='#172629';ctx.fillRect(15,80,1170,175);
  for(let x=45;x<1200;x+=150){ctx.fillStyle='#324348';ctx.fillRect(x,28,85,40);ctx.fillStyle='#7a8f91';ctx.beginPath();ctx.arc(x+40,48,9,0,Math.PI*2);ctx.fill();ctx.fillStyle='#344347';ctx.fillRect(x,257,80,25);}
  ctx.strokeStyle='#536461';ctx.lineWidth=3;ctx.strokeRect(15,25,1170,270);ctx.fillStyle=run?.power?'#b5c395':'#735b45';ctx.fillRect(485,210,65,55);
  ctx.fillStyle=run?.unlocked?'#455e52':'#715342';ctx.fillRect(1100,65,70,205);ctx.strokeStyle='#c4ac72';ctx.strokeRect(1100,65,70,205);
  ctx.fillStyle='#b9c8c0';ctx.font='17px system-ui';ctx.fillText('FUSE',218,88);ctx.fillText('POWER',483,292);ctx.fillText('KEY',720,88);ctx.fillText('LOCK',1000,118);ctx.fillText('EXIT',1115,55);
  const state=run??newRun(70,false);
  for(const object of objects(state)){ctx.fillStyle=object.id==='exit'?'#b5c395':'#d0b57c';ctx.beginPath();ctx.arc(object.x,object.y,object.id==='lock'?18:9,0,Math.PI*2);ctx.fill();}
  ctx.fillStyle='#dce4d8';ctx.beginPath();ctx.arc(state.x,state.y,12,0,Math.PI*2);ctx.fill();ctx.fillStyle='#41585a';ctx.fillRect(state.x-6,state.y-5,12,6);
  const target=nearby(state);if(target){ctx.strokeStyle='#a7b894';ctx.lineWidth=1;ctx.beginPath();ctx.arc(target.x,target.y,70,0,Math.PI*2);ctx.stroke();}
  const aim=aimPoint(state,controls());const x=reduced.checked?(pointerAim?.x??target?.x??state.x+30):aim.x,y=reduced.checked?(pointerAim?.y??target?.y??state.y):aim.y;
  ctx.strokeStyle=aim.error>18?'#da9e7d':'#e9d49d';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x-8,y);ctx.lineTo(x+8,y);ctx.moveTo(x,y-8);ctx.lineTo(x,y+8);ctx.stroke();
  if(state.scareSeen&&state.shock>.25){ctx.fillStyle='#11171b';ctx.beginPath();ctx.ellipse(520,47,15,21,0,0,Math.PI*2);ctx.fill();}
}
function render():void {
  get('keyboard-aim').setAttribute('aria-pressed',String(pointerAim===undefined));
  draw();const active=run?.phase==='running';get<HTMLButtonElement>('pause').disabled=!run||run.phase==='won'||run.phase==='lost';get('pause').textContent=run?.phase==='paused'?'Resume':'Pause';
  for(const id of ['restart','report'])get<HTMLButtonElement>(id).disabled=!run;for(const id of ['interact','steady'])get<HTMLButtonElement>(id).disabled=!active;
  get('steady').textContent=`Steady: ${steadyToggle?'on':'off'}`;get('steady').setAttribute('aria-pressed',String(steadyToggle));
  get('phase').textContent=!run?'Ready to calibrate':run.phase==='won'?'Escaped':run.phase==='lost'?'Run ended':run.phase==='paused'?'Paused':'In the corridor';
  get('run-source').textContent=`Current run source: ${!run?'none':run.source==='simulated'?'Simulator (declared readings)':'Bluetooth heart-rate notifications (hardware unverified)'}`;
  refreshBluetooth();
  if(!run)return;get('timer').textContent=`${Math.ceil(180-run.time)} s`;get('sensor').textContent=run.sensor==='fresh'?`${run.samples.at(-1)!.bpm} BPM · ${run.source==='simulated'?'simulated':'Bluetooth notification'}`:`${run.sensor} sample · neutral fallback`;get('tension').textContent=`${Math.round(run.tension*100)}%`;get<HTMLMeterElement>('tension-meter').value=run.tension;get('noise').textContent=`${Math.round(run.noise)} / 100`;get<HTMLMeterElement>('noise-meter').value=run.noise;get('lock').textContent=`${Math.round(run.lock*100)}%`;get<HTMLProgressElement>('lock-meter').value=run.lock;get('position').textContent=`${Math.round(run.x)}, ${Math.round(run.y)}`;
  const target=nearby(run);get('nearby').textContent=target?`${target.label} · aim error ${aimPoint(run,controls()).error.toFixed(1)} / 18`: 'No object in reach';
  for(const [id,done] of [['fuse',run.fuse],['power',run.power],['key',run.key],['lock',run.unlocked]] as const)get(`goal-${id}`).classList.toggle('done',done);
  const latest=run.events.at(-1);if(latest&&latest!==lastEvent){announce(latest.text);if(latest.kind==='scare')sound();lastEvent=latest;}
}
function frame(timestamp:number):void {
  if(run?.phase==='running'){
    const elapsed=lastFrame?Math.max(0,(timestamp-lastFrame)/1000):0;
    if(run.source==='simulated'&&sampling.checked&&run.time-lastSample>=1){sample(run,Number(reading.value));lastSample=run.time;}
    const before=run.phase;
    try{advance(run,elapsed,controls(),run.source==='bluetooth-hr'?performance.now():undefined);}
    catch{if(run.source==='bluetooth-hr'){invalidateBluetooth(run,'invalid-clock');pause(run);release();bluetoothFeedback='Game paused after an invalid sensor clock. Reconnect and collect a new baseline.';}else throw Error('Invalid game clock.');}
    if(before==='running'&&(run as Run).phase==='won'&&run.source==='simulated'){
      if(settings.bestSeconds===null||run.time<settings.bestSeconds){settings.bestSeconds=run.time;if(!storageBlocked){try{saveSettings(localStorage,settings);storageStatus('Best completed time saved. No simulated samples were stored.');}catch{storageStatus('Best time is in memory; local save failed. Download the run report.');}}}
    }
    render();
  }
  lastFrame=timestamp;refreshBluetooth();requestAnimationFrame(frame);
}

function clearCalibration(text='Baseline: 0/5 received readings. Choose Collect baseline for a new Bluetooth run.'):void {
  startIntent++;calibration?.invalidate();calibration=null;calibrationConnection=null;calibrationText=text;
}
function readyBaseline() {
  if(disposed||document.hidden||bluetoothState.phase!=='connected'||!calibration||bluetoothState.connectionId!==calibrationConnection)return null;
  return calibration.snapshot(performance.now()).result;
}
function updateText(id:string,text:string):void {if(get(id).textContent!==text)get(id).textContent=text;}
let bluetoothFeedback:string|null=null;
function refreshBluetooth():void {
  let snapshot:CalibrationSnapshot|null=null;
  if(calibration){
    try{snapshot=calibration.snapshot(performance.now());}
    catch{clearCalibration('Baseline invalidated by a clock error. Collect again after reconnecting.');if(run?.source==='bluetooth-hr')invalidateBluetooth(run,'invalid-clock');}
  }
  if(snapshot){
    const labels:Record<CalibrationSnapshot['state'],string>={collecting:'Collecting baseline',ready:'Baseline ready',expired:'Baseline expired — collect again',failed:'Readings varied too much — collect again',invalidated:'Baseline invalidated — collect again'};
    calibrationText=`${labels[snapshot.state]}: ${snapshot.count}/5 received readings.${snapshot.result?` Baseline ${snapshot.result.baseline} BPM. Start within 10 seconds of the fifth reading.`:' Five eligible readings must span at least 4 seconds, with at most 12 BPM spread.'}`;
  }
  updateText('ble-calibration',calibrationText);
  updateText('ble-status',bluetoothFeedback??bluetoothState.message);
  const ble=nextSource.value==='bluetooth-hr',connected=bluetoothState.phase==='connected';
  get<HTMLButtonElement>('ble-connect').disabled=disposed||!ble||!['idle','error'].includes(bluetoothState.phase);
  get<HTMLButtonElement>('ble-cancel').disabled=disposed||!['choosing','connecting'].includes(bluetoothState.phase);
  get<HTMLButtonElement>('ble-disconnect').disabled=disposed||!connected;
  get<HTMLButtonElement>('ble-calibrate').disabled=disposed||!ble||!connected;
  get<HTMLButtonElement>('start').textContent=ble?'Start Bluetooth run':'Calibrate & start';
  get<HTMLButtonElement>('start').disabled=ble&&(disposed||!connected||snapshot?.state!=='ready'||calibrationConnection!==bluetoothState.connectionId);
  get<HTMLFieldSetElement>('simulator-controls').disabled=ble||run?.source==='bluetooth-hr';
  updateText('sensor-label',run?.source==='bluetooth-hr'?'Received Bluetooth heart rate':'Declared simulated reading');
}
function receiveBluetooth(notification:HeartRateNotification):void {
  if(disposed||bluetoothState.phase!=='connected'||notification.connectionId!==bluetoothState.connectionId)return;
  try{
    // Consume the stamped receipt before sampling a newer clock for status.
    // In particular, contact loss reaches calibration before any throttling.
    if(calibration&&calibrationConnection===notification.connectionId)calibration.observe(notification);
    else if(run?.source==='bluetooth-hr'&&run.phase==='running')sampleBluetooth(run,notification);
    bluetoothFeedback=null;
  }catch{
    clearCalibration('Baseline invalidated by a clock or notification error. Collect again.');
    if(run?.source==='bluetooth-hr'){invalidateBluetooth(run,'invalid-clock');if(run.phase==='running')pause(run);}
    release();lastFrame=0;bluetoothFeedback='The sensor clock or notification was invalid. The old reading is not reused. Disconnect and reconnect explicitly.';
  }
  render();
}
function bluetoothChanged(snapshot:BluetoothSnapshot):void {
  const previous=bluetoothState.connectionId;bluetoothState={...snapshot};bluetoothFeedback=null;
  if(snapshot.phase!=='connected'||previous!==null&&previous!==snapshot.connectionId){
    if(calibration)clearCalibration('Baseline invalidated by connection change. Reconnect and collect five new readings.');
    if(run?.source==='bluetooth-hr')invalidateBluetooth(run,'disconnected');
  }
  refreshBluetooth();
}
nextSource.addEventListener('change',()=>{
  clearCalibration();
  if(['choosing','connecting','draining'].includes(bluetoothState.phase))transport?.cancel();
  render();
});
get('ble-connect').addEventListener('click',()=>{
  if(disposed||nextSource.value!=='bluetooth-hr')return;
  inactive();clearCalibration();bluetoothFeedback=null;
  // requestDevice must be invoked in this user-activation stack.
  void transport?.connect().catch(()=>{bluetoothFeedback='Could not connect. Choose Connect heart-rate sensor to try again.';refreshBluetooth();});
  refreshBluetooth();
});
get('ble-cancel').addEventListener('click',()=>{clearCalibration();transport?.cancel();refreshBluetooth();});
get('ble-disconnect').addEventListener('click',()=>{clearCalibration();transport?.disconnect();if(run?.source==='bluetooth-hr')invalidateBluetooth(run,'disconnected');render();});
get('ble-calibrate').addEventListener('click',()=>{
  if(disposed||nextSource.value!=='bluetooth-hr'||bluetoothState.phase!=='connected'||bluetoothState.connectionId===null)return;
  inactive();clearCalibration();
  try{calibrationConnection=bluetoothState.connectionId;calibration=new HeartRateCalibration(calibrationConnection,performance.now());bluetoothFeedback=null;}
  catch{clearCalibration('Could not begin baseline collection. Reconnect explicitly and try again.');}
  refreshBluetooth();
});
const provider=isSecureContext?(navigator as Navigator&{bluetooth?:BluetoothProvider}).bluetooth??null:null;
transport=new BluetoothHeartRate(provider,{
  onState:bluetoothChanged,
  onMeasurement:receiveBluetooth,
  onRejected:()=>{if(!disposed){bluetoothFeedback='An invalid heart-rate packet was ignored. It did not refresh the game reading.';refreshBluetooth();}},
});
bluetoothState=transport.snapshot();

render();requestAnimationFrame(frame);
