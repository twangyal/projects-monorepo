/** Original maximum-graph saved-copy oracle. No product imports or storage writes.
 * --fixtures-only freezes inputs and literal expectations before browser outcomes.
 */
/* global process, Buffer, URL, console, indexedDB, btoa, structuredClone, crypto, document, innerWidth */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {chromium,expect} from '@playwright/test';

const FRAMES=441000,SELECTED='original-fractional-note';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const encoded=value=>Buffer.from(JSON.stringify(value));
const uuid=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const EXPECTED={tracks:8,notesPerTrack:256,totalNotes:2048,references:8,framesPerReference:441000,pcmBytesPerReference:882000,totalPcmBytes:7056000,
  originalTitle:'Original maximum saved-copy graph',winnerTitle:'Distinct maximum graph from other tab',localTitle:'Stale maximum local work',
  originalNote:{id:SELECTED,pitch:69,start:.13,duration:.25,velocity:.75},
  localNote:{id:SELECTED,pitch:70,start:.13,duration:.25,velocity:.75},
  winnerNote:{id:SELECTED,pitch:76,start:.375,duration:.375,velocity:.75},
  savedRowSchema:2,portableVersion:1,rawTempo:'',rawFieldsExcluded:true};
function asset(n){
  const pcm=Buffer.alloc(FRAMES*2);
  for(let i=0;i<FRAMES;i++)pcm.writeInt16LE(((i*97+n*503)%65536)-32768,i*2);
  return{id:uuid(n),kind:'audio-file',captureTempo:40,decodedSampleRate:44100,decodedChannels:2,
    decodedFrames:882000,analyzedFrames:882000,frameCount:FRAMES,sha256:sha(pcm),pcmBase64:pcm.toString('base64')};
}
function original(){
  const tracks=Array.from({length:8},(_,i)=>({id:`original-track-${i}`,name:`Original maximum track ${i+1}`,instrument:'sine',volume:.8,muted:i!==0,
    notes:Array.from({length:256},(_,n)=>i===0&&n===0?{...EXPECTED.originalNote}:{id:`original-note-${i}-${n}`,pitch:60+n%5,start:n*.5,duration:.5,velocity:i===0?0:.75})}));
  const assets=Array.from({length:8},(_,i)=>asset(i+1));
  return{format:'melody-studio-project',version:1,document:{schemaVersion:1,composition:{version:1,title:EXPECTED.originalTitle,tempo:240,tracks},
    references:assets.map((a,i)=>({trackId:tracks[i].id,assetId:a.id}))},assets};
}
function winner(a){
  const b=structuredClone(a);b.document.composition.title=EXPECTED.winnerTitle;b.document.composition.tempo=200;
  for(const t of b.document.composition.tracks){t.name=`Other tab ${t.name}`;for(const n of t.notes)n.pitch+=2;}
  b.document.composition.tracks[0].notes[0]={...EXPECTED.winnerNote};
  b.assets=Array.from({length:8},(_,i)=>asset(i+101));
  b.document.references=b.assets.map((a,i)=>({trackId:b.document.composition.tracks[i].id,assetId:a.id}));
  return b;
}
function assetsReceipt(project){
  assert.equal(project.assets.length,EXPECTED.references);let total=0;
  const receipt=project.assets.map(a=>{const pcm=Buffer.from(a.pcmBase64,'base64');assert.equal(pcm.length,EXPECTED.pcmBytesPerReference);assert.equal(sha(pcm),a.sha256);total+=pcm.length;return{id:a.id,bytes:pcm.length,sha256:a.sha256};});
  assert.equal(total,EXPECTED.totalPcmBytes);return receipt;
}
function assertGraph(actual,expected){
  assert.deepEqual(actual,expected);
  assert.equal(actual.document.composition.tracks.length,8);
  assert(actual.document.composition.tracks.every(t=>t.notes.length===256));
  assert.equal(actual.document.composition.tracks.reduce((n,t)=>n+t.notes.length,0),2048);
  assert.deepEqual(assetsReceipt(actual),assetsReceipt(expected));
}
async function stored(page){
  return page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('melody-studio.projects',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{
      const captured=await new Promise((resolve,reject)=>{
        const tx=db.transaction(['projects','assets'],'readonly');let row,assets;
        const descriptor=tx.objectStore('projects').get('current'),all=tx.objectStore('assets').getAll();
        descriptor.onsuccess=()=>{row=descriptor.result;};all.onsuccess=()=>{assets=all.result;};
        tx.oncomplete=()=>resolve({row,assets});tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
      });
      const assets=[];
      for(const asset of captured.assets){
        const {pcm,...metadata}=asset,bytes=new Uint8Array(await pcm.arrayBuffer());
        let binary='';for(let at=0;at<bytes.length;at+=8192)binary+=String.fromCharCode(...bytes.subarray(at,at+8192));
        const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
        assets.push({...metadata,blobMime:pcm.type,blobBytes:pcm.size,actualSha256:Array.from(digest,x=>x.toString(16).padStart(2,'0')).join(''),pcmBase64:btoa(binary)});
      }
      assets.sort((a,b)=>a.id.localeCompare(b.id));return{row:captured.row,assets};
    }finally{db.close();}
  });
}
function assertStored(receipt,project){
  assert.deepEqual(Object.keys(receipt.row).sort(),['document','revision','schemaVersion']);
  assert.equal(receipt.row.schemaVersion,2);assert.match(receipt.row.revision,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(receipt.row.document,project.document);
  const expected=project.assets.map(({pcmBase64,...metadata})=>({...metadata,blobMime:'',blobBytes:882000,actualSha256:metadata.sha256,pcmBase64})).sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(receipt.assets,expected);
}
async function processIds(context){const client=await context.browser().newBrowserCDPSession();try{return(await client.send('SystemInfo.getProcessInfo')).processInfo.filter(p=>p.type==='browser').map(p=>p.id);}finally{await client.detach();}}
async function main(){
  const explicit=process.env.MELODY_CONFLICT_OUTPUT;
  const out=explicit?resolve(explicit):await mkdtemp(join(tmpdir(),'melody-save-conflict-'));
  if(explicit)await mkdir(out,{recursive:false});
  const a=original(),b=winner(a),local=structuredClone(a);local.document.composition.title=EXPECTED.localTitle;local.document.composition.tracks[0].notes[0]={...EXPECTED.localNote};
  const evidence={schemaVersion:1,issue:98,status:'fixtures-only',output:out,expected:EXPECTED,fixtures:[],artifacts:[],checks:[],phases:[],pageErrors:[],externalRequests:[],limitations:[
    'Original modular PCM is a retained-byte identity fixture, not real microphone or transcription accuracy evidence.',
    'Only ordinary UI imports/keyboard/title edits/review confirmations write project state; native IndexedDB access is readonly.',
    'No producer serializers/models/storage helpers, API mocks, injected saved state, audio synthesis, device or physical mobile claim.',
  ]};
  const publish=()=>writeFile(join(out,'verification.json'),JSON.stringify(evidence,null,2)+'\n');
  const artifact=async(name,bytes)=>{await writeFile(join(out,name),bytes,{flag:'wx'});evidence.artifacts.push({name,bytes:bytes.length,sha256:sha(bytes)});return bytes;};
  for(const[name,p]of[['original-a.melody.json',a],['foreign-b.melody.json',b],['expected-local-a.melody.json',local]]){
    const bytes=encoded(p);await writeFile(join(out,name),bytes,{flag:'wx'});evidence.fixtures.push({name,bytes:bytes.length,sha256:sha(bytes),assets:assetsReceipt(p)});
  }
  assertGraph(a,a);assertGraph(b,b);assertGraph(local,local);
  assert(a.assets.every((asset,index)=>asset.id!==b.assets[index].id&&asset.sha256!==b.assets[index].sha256));
  await publish();
  if(process.argv.includes('--fixtures-only')){console.log(JSON.stringify({status:evidence.status,out,fixtures:evidence.fixtures.map(({name,bytes,sha256})=>({name,bytes,sha256}))},null,2));return;}
  const base=process.env.MELODY_CONFLICT_BASE_URL;assert(base,'Set MELODY_CONFLICT_BASE_URL only after root releases the browser slot.');
  const url=new URL(base);assert.equal(url.protocol,'http:');assert(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
  let context,page,stale;const started=performance.now();
  const trackPage=p=>{p.on('pageerror',e=>evidence.pageErrors.push(e.message));p.on('request',r=>{const u=new URL(r.url());if(/^https?:$/.test(u.protocol)&&u.origin!==url.origin)evidence.externalRequests.push(u.origin);});};
  const phase=async(name,work)=>{const start=performance.now();await work();evidence.phases.push({name,wallMs:performance.now()-start});await publish();};
  const launch=async()=>{context=await chromium.launchPersistentContext(join(out,'profile'),{...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,acceptDownloads:true,viewport:{width:1440,height:1000}});page=context.pages()[0];trackPage(page);await page.goto(base);await expect(page.getByRole('button',{name:'Save project file',exact:true})).toBeEnabled();};
  const download=async(p,name,expected)=>{const event=p.waitForEvent('download');await p.getByRole('button',{name:'Save project file',exact:true}).click();const d=await event;const path=await d.path();assert(path);const bytes=await readFile(path);assertGraph(JSON.parse(bytes.toString('utf8')),expected);await artifact(name,bytes);return bytes;};
  const open=async(p,name,expected)=>{p.once('dialog',d=>d.accept());await p.getByLabel('Open project file',{exact:true}).setInputFiles(join(out,name));await expect(p.getByLabel('Project title')).toHaveValue(expected.document.composition.title);await expect(p.locator('#save-status')).toHaveText('Saved in this browser');};
  const replacement=async accept=>{
    const waiting=stale.waitForEvent('dialog'),click=stale.locator('#replace-saved-copy').click();
    const dialog=await waiting;assert.match(dialog.message(),/Distinct maximum graph from other tab/);assert.match(dialog.message(),/committed local notes and reference audio/);assert.match(dialog.message(),/Unapplied fields and suggestions are excluded/);
    evidence.confirmations??=[];evidence.confirmations.push({accepted:accept,message:dialog.message()});
    if(accept)await dialog.accept();else await dialog.dismiss();await click;
  };
  try{
    await launch();evidence.browserVersion=context.browser().version();evidence.origin=url.origin;evidence.scripts=await page.locator('script[src]').evaluateAll(nodes=>nodes.map(n=>new URL(n.src).pathname));evidence.firstBrowserProcess=await processIds(context);
    await phase('original maximum saved graph and genuine second-tab restore',async()=>{
      await open(page,'original-a.melody.json',a);await download(page,'original-ui-backup.melody.json',a);
      stale=await context.newPage();trackPage(stale);await stale.goto(base);await expect(stale.locator('#save-status')).toHaveText('Restored from this browser');await download(stale,'stale-before-conflict.melody.json',a);
      await expect(stale.locator('[data-track]')).toHaveCount(8);await expect(stale.locator('[data-note]')).toHaveCount(256);
    });
    let durableWinner;
    await phase('other tab commits all eight distinct replacement PCM assets',async()=>{
      await open(page,'foreign-b.melody.json',b);durableWinner=await stored(page);assertStored(durableWinner,b);await artifact('foreign-durable-receipt.json',encoded(durableWinner));
    });
    let chosen;
    await phase('stale ordinary roll and title edits conflict without replacing any foreign byte',async()=>{
      await stale.locator(`[data-note="${SELECTED}"]`).focus();await stale.keyboard.press('ArrowUp');await expect(stale.locator('#save-status')).toContainText(/another tab|conflict/i);
      await stale.getByLabel('Project title').fill(EXPECTED.localTitle);await stale.getByLabel('Project title').press('Tab');
      await stale.getByLabel('Tempo (BPM)').fill('');const raw=await stale.getByLabel('Tempo (BPM)').elementHandle();assert(raw);
      await expect(stale.locator('#retry-save')).toBeHidden();await expect(stale.locator('#retry-load')).toBeVisible();await expect(stale.locator('#replace-saved-copy')).toBeVisible();
      assert.deepEqual(await stored(page),durableWinner);chosen=await download(stale,'stale-local-complete.melody.json',local);
      await expect(stale.getByLabel('Tempo (BPM)')).toHaveValue('');assert(await raw.evaluate(node=>node.isConnected));
      evidence.checks.push('All 2048 local notes/eight original PCM survive conflict, while foreign schema2 descriptor and all eight distinct PCM remain byte-exact; rawblanktempo stays unapplied.');
    });
    await phase('cancel fresh saved-copy review preserves both complete graphs',async()=>{
      await replacement(false);await expect(stale.locator('#save-status')).toContainText(/cancelled/i);await expect(stale.locator('#replace-saved-copy')).toBeVisible();
      assert.deepEqual(await stored(page),durableWinner);assert(chosen.equals(await download(stale,'after-cancel-local.melody.json',local)));await expect(stale.getByLabel('Tempo (BPM)')).toHaveValue('');
    });
    let replacedReceipt;
    await phase('deliberately reviewed CAS publishes only committed local graph',async()=>{
      await replacement(true);await expect(stale.locator('#save-status')).toHaveText('Saved in this browser');await expect(stale.getByLabel('Tempo (BPM)')).toHaveValue('');
      replacedReceipt=await stored(stale);assertStored(replacedReceipt,local);assert.notEqual(replacedReceipt.row.revision,durableWinner.row.revision);
      assert(chosen.equals(await download(stale,'after-reviewed-replacement.melody.json',local)));await artifact('replaced-durable-receipt.json',encoded(replacedReceipt));
      await stale.screenshot({path:join(out,'desktop-conflict-replacement.png')});await artifact('desktop-conflict-replacement.png.receipt.json',encoded({pngSha256:sha(await readFile(join(out,'desktop-conflict-replacement.png')))}));
      evidence.checks.push('Cancel is nondestructive; fresh explicit confirmation/CAS replaces the foreign copy with committed local notes/audio only, retaining blank raw tempo and a new storage UUID.');
    });
    await context.close();context=null;
    await phase('whole browser process restart retains exact chosen complete backup',async()=>{
      await launch();evidence.secondBrowserProcess=await processIds(context);assert.notDeepEqual(evidence.firstBrowserProcess,evidence.secondBrowserProcess);
      await expect(page.locator('#save-status')).toHaveText('Restored from this browser');await expect(page.getByLabel('Project title')).toHaveValue(EXPECTED.localTitle);
      const bytes=await download(page,'after-process-restart.melody.json',local);assert(chosen.equals(bytes));assert.deepEqual(await stored(page),replacedReceipt);
      evidence.restart={bytes:bytes.length,sha256:sha(bytes),byteExact:true};
      await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(out,'390px-restored.png')});
      evidence.checks.push('New browser process restores an identical schema2 row/all PCM and byte-identical complete portable backup; raw unapplied tempo was excluded.');
    });
    for(const name of ['desktop-conflict-replacement.png','390px-restored.png']){const bytes=await readFile(join(out,name));evidence.artifacts.push({name,bytes:bytes.length,sha256:sha(bytes)});}
    assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.externalRequests,[]);evidence.status='passed';evidence.totalWallMs=performance.now()-started;
  }catch(error){evidence.status='failed';evidence.failure={name:error.name,message:error.message,stack:error.stack};throw error;}
  finally{await context?.close();await publish();}
  console.log(JSON.stringify({status:evidence.status,out,wallMs:evidence.totalWallMs,restart:evidence.restart,phases:evidence.phases},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
