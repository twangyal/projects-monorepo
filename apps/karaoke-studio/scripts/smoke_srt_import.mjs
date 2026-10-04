/* global Buffer, console, process, URL, window, setTimeout, clearTimeout */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
import {chromium,expect} from '@playwright/test';
const APP=resolve(dirname(fileURLToPath(import.meta.url)),'..'),runFile=promisify(execFile),PYTHON=process.env.KARAOKE_PYTHON||'python3';
const hash=b=>createHash('sha256').update(b).digest('hex');
const stamp=ms=>`${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;
const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function srt(cues){return Buffer.from(cues.map((c,i)=>`${i+1}\n${stamp(Math.floor(c.start*1000+.5))} --> ${stamp(Math.floor(c.end*1000+.5))}\n${escape(c.text)}\n`).join('\n'));}
async function fixtures(out){
  await mkdir(out,{recursive:false});
  const maximum=Array.from({length:200},(_,i)=>{
    let text=`  Cue ${String(i+1).padStart(3,'0')}: café 🦉 <literal> &amp; &unknown;\n`;
    text+='x'.repeat(98-[...text].length);text+='  ';assert.equal([...text].length,100);
    return{start:i*1.5,end:i===199?300:i*1.5+1.125,text};
  });
  const short=[{start:.5,end:1.5,text:'Silver opening line'},{start:2,end:3.5,text:'Amber middle line'},{start:4.25,end:5.5,text:'Cobalt closing line'}];
  const ids=['1'.repeat(32),'2'.repeat(32)],projects=[300,6].map((duration,i)=>({schemaVersion:1,id:ids[i],title:i===0?'Original maximum timed-lyrics study':'Original short timing study',duration,revision:3,cues:[{start:.125,end:.875,text:'Before imported words'}]}));
  const expected=projects.map((p,i)=>({...p,revision:4,cues:i===0?maximum:short}));
  const expectedMaximum=srt(maximum),expectedShort=srt(short);
  const core=Buffer.concat([Buffer.from([239,187,191]),Buffer.from(expectedMaximum.toString().replaceAll('\n','\r\n'))]);
  assert(core.length<131072);const padded=Buffer.concat([core,Buffer.alloc(131072-core.length,10)]);
  const files=[['maximum-200.srt',expectedMaximum],['maximum-exact-128KiB.srt',padded],['maximum-plus-one.srt',Buffer.concat([padded,Buffer.from('\n')])],['short-boundaries.srt',expectedShort],['maximum-export-expected.srt',expectedMaximum],['short-export-expected.srt',expectedShort]];
  const facts=[];for(const[name,bytes]of files){await writeFile(join(out,name),bytes);facts.push({name,bytes:bytes.length,sha256:hash(bytes)});}
  const frames=[0,11,12,35,36,47,48,83,84,101,102,131,132,143].map(frame=>({frame,text:frame>=12&&frame<36?short[0].text:frame>=48&&frame<84?short[1].text:frame>=102&&frame<132?short[2].text:'Instrumental break',active:(frame>=12&&frame<36)||(frame>=48&&frame<84)||(frame>=102&&frame<132)}));
  const receipt={schemaVersion:1,status:'fixtures-frozen',projects,expected,files: facts,maximum:{duration:300,cues:200,characters:maximum.reduce((n,c)=>n+[...c.text].length,0),fileBytes:131072,overflowBytes:131073},
    video:{duration:6,frames:144,fps:24,dimensions:[1280,720],samples:frames,glyphThresholds:{coreMaskMin:240,channelTolerance:35,minCoreCoverage:.9,maskDilationPixels:2,minSpatialPrecision:.95}},
    limits:['Original synthetic PCM is not source-separated music or model quality evidence.','Only short6second video is encoded;300second scope is SRT/audio/archive/persistence.','128KiB source capacity uses explicit trailing empty lines;200 decoded cue texts total20,000 Unicode code points.','No parser/UI/producer expected-value imports; one-pass escaped-entity and literal spacing expectations are original.']};
  assert.equal(receipt.maximum.characters,20000);await writeFile(join(out,'frozen-expectations.json'),JSON.stringify(receipt,null,2)+'\n');
  await runFile(PYTHON,['tests/srt_smoke_server.py','--seed',out],{cwd:APP,timeout:60000,maxBuffer:65536});
  console.log(JSON.stringify({status:receipt.status,out,maximum:receipt.maximum,videoFrames:frames.map(x=>x.frame)}));
}
async function service(root,port=0){
  const child=spawn(PYTHON,['tests/srt_smoke_server.py','--serve',root,'--port',String(port)],{cwd:APP,stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',b=>{errors=(errors+b.toString()).slice(-4096);});
  const close=async()=>{if(child.exitCode!==null)return;await new Promise((done,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Owned SRT service failed to stop.'));},15000);child.once('exit',()=>{clearTimeout(timer);done();});child.kill('SIGTERM');});};
  try{const actual=await new Promise((done,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('SRT service readiness timeout.')),15000);child.once('exit',()=>{clearTimeout(timer);reject(Error('SRT service startup failed: '+errors));});child.stdout.on('data',b=>{text+=b.toString();if(text.includes('\n')){clearTimeout(timer);const n=Number(text.split('\n')[0]);if(Number.isInteger(n)&&n>0)done(n);else reject(Error('Invalid service readiness.'));}});});return{origin:`http://127.0.0.1:${actual}`,port:actual,pid:child.pid,close};}catch(error){await close();throw error;}
}
async function download(page,locator,path){const ready=page.waitForEvent('download',{timeout:120000});await locator.click();const item=await ready;await item.saveAs(path);return readFile(path);}
async function runtime(fixtureRoot,out){
  const frozenBytes=await readFile(join(fixtureRoot,'frozen-expectations.json'));assert.equal(hash(frozenBytes),'7d5f96da1a97c6d0cdfeaed7a121268c271113926c376bc661ac30e1197bcfa4','Frozen expectations changed.');const frozen=JSON.parse(frozenBytes);
  for(const f of frozen.files){const data=await readFile(join(fixtureRoot,f.name));assert.equal(data.length,f.bytes);assert.equal(hash(data),f.sha256);}
  await mkdir(out,{recursive:false});await cp(join(fixtureRoot,'library'),join(out,'library'),{recursive:true,errorOnExist:true});
  const sourceHashes={};for(const name of ['scripts/smoke_srt_import.mjs','tests/srt_smoke_server.py','scripts/smoke_archive.py','assets/DejaVuSans.ttf'])sourceHashes[name]=hash(await readFile(join(APP,name)));
  const report={status:'running',frozenSha256:hash(frozenBytes),sourceHashes,fixtureRoot,out,scope:frozen.limits,services:[],browserProcesses:[],artifacts:[],checks:[],errors:[],external:[]};
  const save=()=>writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');let host,context,page;const start=performance.now();
  const launch=async()=>{context=await chromium.launchPersistentContext(join(out,'profile'),{headless:true,acceptDownloads:true,viewport:{width:1280,height:960},...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});page=context.pages()[0];report.browserVersion=context.browser().version();const session=await context.browser().newBrowserCDPSession();report.browserProcesses.push(...(await session.send('SystemInfo.getProcessInfo')).processInfo.filter(x=>x.type==='browser').map(x=>x.id));await session.detach();page.on('dialog',d=>d.accept());page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==host.origin)report.external.push(r.url());});};
  const artifact=async(name,bytes)=>{await writeFile(join(out,name),bytes);report.artifacts.push({name,bytes:bytes.length,sha256:hash(bytes)});};
  const saved=async id=>{const r=await page.request.get(`${host.origin}/api/projects/${id}`);assert.equal(r.status(),200);return r.json();};
  const open=async project=>{await page.goto(`${host.origin}/?project=${project.id}`);await expect(page.getByLabel('Clip title',{exact:true})).toHaveValue(project.title);await expect(page.locator('#srt-file')).toBeEnabled();};
  try{
    host=await service(join(out,'library'));report.services.push(host.pid);await launch();
    for(let index=0;index<2;index++){
      const old=frozen.projects[index],expected=frozen.expected[index];await open(old);
      const pasted='  Retain these unapplied words 🦉\nSecond untouched line  ';await page.getByLabel('Paste lyrics, one line per cue',{exact:true}).fill(pasted);
      const input=await readFile(join(fixtureRoot,index===0?'maximum-exact-128KiB.srt':'short-boundaries.srt'));
      await page.locator('#srt-file').setInputFiles({name:index===0?'maximum.srt':'short.srt',mimeType:'application/x-subrip',buffer:input});
      await expect(page.locator('#srt-review')).toBeVisible();await expect(page.locator('#srt-apply')).toBeEnabled();
      assert.deepEqual(await saved(old.id),old,'Review must not save or partially apply.');
      // Every exact text must be represented safely by the complete native review.
      await expect(page.locator('#srt-review-list li[data-srt-cue]')).toHaveCount(expected.cues.length);
      const review=await page.locator('#srt-review-list').textContent();for(const cue of expected.cues)assert(review.includes(cue.text),'Full literal review omitted or normalized a cue.');
      await page.locator('#srt-apply').click();await expect(page.getByLabel(`Lyric line ${expected.cues.length}`,{exact:true})).toHaveValue(expected.cues.at(-1).text);
      assert.deepEqual(await saved(old.id),old,'Apply is unsaved memory only.');
      await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue(old.cues[0].text);await expect(page.getByLabel('Paste lyrics, one line per cue',{exact:true})).toHaveValue(pasted);
      await page.getByRole('button',{name:'Redo lyric edit',exact:true}).click();await expect(page.getByLabel(`Lyric line ${expected.cues.length}`,{exact:true})).toHaveValue(expected.cues.at(-1).text);
      await expect(page.getByLabel('Clip title',{exact:true})).toHaveValue(old.title);await expect(page.getByLabel('Paste lyrics, one line per cue',{exact:true})).toHaveValue(pasted);await expect(page.getByRole('button',{name:'Save lyrics',exact:true})).toBeDisabled();
      await page.locator('#discard-draft').click();await expect(page.getByLabel('Paste lyrics, one line per cue',{exact:true})).toHaveValue(expected.cues.map(c=>c.text).join('\n'));
      await page.getByRole('button',{name:'Save lyrics',exact:true}).click();await expect(page.locator('#message')).toContainText('saved locally');assert.deepEqual(await saved(old.id),expected);
      const name=index===0?'maximum-saved.srt':'short-saved.srt',bytes=await download(page,page.getByRole('button',{name:'Export timed lyrics',exact:true}),join(out,name));
      assert(bytes.equals(await readFile(join(fixtureRoot,index===0?'maximum-export-expected.srt':'short-export-expected.srt'))));await artifact(name,bytes);
      if(index===0){
        await page.locator('#srt-file').setInputFiles({name:'over-limit.srt',mimeType:'application/x-subrip',buffer:await readFile(join(fixtureRoot,'maximum-plus-one.srt'))});
        await expect(page.locator('#srt-status')).toContainText(/128|large|limit/i);await expect(page.locator('#srt-apply')).toBeHidden();assert.deepEqual(await saved(old.id),expected);
        await expect(page.getByLabel('Lyric line 200',{exact:true})).toHaveValue(expected.cues[199].text);report.checks.push('Exact128KiB accepted;128KiB+1 refused without changing200cues/20k literal code points.');
      }else{
        const video=await download(page,page.getByRole('button',{name:'Export karaoke MP4',exact:true}),join(out,'short-boundaries.mp4'));await artifact('short-boundaries.mp4',video);
        const checked=await runFile(PYTHON,['tests/srt_smoke_server.py','--inspect-video',join(out,'short-boundaries.mp4'),'--expectations',join(fixtureRoot,'frozen-expectations.json')],{cwd:APP,timeout:120000,maxBuffer:1024*1024});report.video=JSON.parse(checked.stdout);
      }
      report.checks.push(`Project${index+1} full native File review/one UndoRedo/manual Save/exact SRT export verified.`);await save();
    }
    await open(frozen.expected[0]);await page.locator('#archive-backup').click();await expect(page.getByRole('link',{name:'Download saved archive',exact:true})).toBeVisible({timeout:30000});
    const archive=await download(page,page.getByRole('link',{name:'Download saved archive',exact:true}),join(out,'maximum.karaoke.zip'));await artifact('maximum.karaoke.zip',archive);
    const checked=await runFile(PYTHON,['tests/srt_smoke_server.py','--inspect-archive',join(out,'maximum.karaoke.zip'),'--expectations',join(fixtureRoot,'frozen-expectations.json'),'--audio-facts',join(fixtureRoot,'audio-facts.json')],{cwd:APP,timeout:30000,maxBuffer:1024*1024});report.archive=JSON.parse(checked.stdout);
    await page.getByLabel('Import project archive',{exact:true}).setInputFiles(join(out,'maximum.karaoke.zip'));await expect(page.getByRole('button',{name:'Open imported clip',exact:true})).toBeVisible({timeout:60000});await page.getByRole('button',{name:'Open imported clip',exact:true}).click();
    const importedId=new URL(page.url()).searchParams.get('project');assert(importedId&&importedId!==frozen.projects[0].id);const imported={...frozen.expected[0],id:importedId};assert.deepEqual(await saved(importedId),imported);report.importedId=importedId;
    const port=host.port;await context.close();context=undefined;await host.close();host=await service(join(out,'library'),port);report.services.push(host.pid);await launch();await open(imported);assert.deepEqual(await saved(importedId),imported);
    const after=await download(page,page.getByRole('button',{name:'Export timed lyrics',exact:true}),join(out,'restart-maximum.srt'));assert(after.equals(await readFile(join(fixtureRoot,'maximum-export-expected.srt'))));await artifact('restart-maximum.srt',after);
    for(const role of['original','vocals','backing']){const r=await page.request.get(`${host.origin}/api/projects/${importedId}/audio/${role}`);assert.equal(r.status(),200);const facts=JSON.parse(await readFile(join(fixtureRoot,'audio-facts.json'),'utf8'));const data=await r.body();assert.equal(hash(data),facts[frozen.projects[0].id][role==='original'?'source.wav':role+'.wav'].sha256);}
    await page.screenshot({path:join(out,'desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>window.document.documentElement.scrollWidth<=window.innerWidth),true);await page.screenshot({path:join(out,'mobile-390.png'),fullPage:true});
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);report.checks.push('Actual complete archive File restore and full service/Chromium restart preserve200cues,exactSRT,and all original WAV bytes.');report.status='passed';report.wallMs=performance.now()-start;await save();console.log(JSON.stringify({status:report.status,out,wallMs:report.wallMs}));
  }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};throw error;}
  finally{await context?.close();await host?.close();report.allOwnedProcessesClosed=true;await save();}
}
async function main(){const fixturesRoot=resolve(process.env.KARAOKE_SRT_FIXTURES||'/workspace/karaoke105-maximum-fixtures');if(process.argv.includes('--fixtures-only'))await fixtures(fixturesRoot);else{assert(process.argv.includes('--run-existing'));await runtime(fixturesRoot,resolve(process.env.KARAOKE_SRT_OUTPUT||'/workspace/karaoke105-maximum-final'));}}
main().catch(error=>{console.error(error);process.exitCode=1;});
