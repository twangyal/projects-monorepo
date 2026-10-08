// Neutral native Blob-download experiment for #128. No app/module imports.
// This records measurements; completion of the experiment is not acceptance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {saveDownload} from './download-diagnostics.mjs';

const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at<0?null:args[at+1];};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function main(){
 const output=option('--output');if(!output)throw Error('Use --output NEW_DIRECTORY.');
 const initialDownloads=Number(option('--initial-downloads')??1);
 if(!Number.isInteger(initialDownloads)||initialDownloads<1||initialDownloads>16)throw Error('--initial-downloads must be an integer from 1 to 16.');
 const postfix=process.env.SHOT_POSTFIX_CHROMIUM_PATH;
 const dir=resolve(output);await mkdir(dir,{recursive:false});
 const payload=Buffer.alloc(11554385);for(let i=0;i<payload.length;i++)payload[i]=(i*31+17)&255;
 const root=await mkdtemp(join(tmpdir(),'shot128-owned-'));
 const report={schemaVersion:2,issue:128,initialDownloads,postfixConfigured:Boolean(postfix),status:'running',payload:{bytes:payload.length,sha256:digest(payload),source:'original deterministic byte pattern; size matches accepted complete archive'},cases:[],limits:['Neutral memory-backed Blob outside the app; no IndexedDB/archive decoder/rendering/encoder.','Each case uses a fresh synthetic profile; the recorded initial-download count then one after an actual browser-process restart. No retry.','Full Chromium and headless-shell are distinct measured browser environments, not interchangeable compatibility claims.','Only root-owned synthetic directories are removed. No user profile or data is accessed.']};
 const save=()=>writeFile(join(dir,'report.json'),JSON.stringify(report,null,2)+'\n');await save();
 try{
  for(const mode of ['full-temporary','full-persistent','headless-temporary',...(postfix?['postfix-full-persistent']:[])]){
   const owned=join(root,mode),profile=join(owned,'profile'),downloads=join(owned,'downloads');await mkdir(owned);if(mode.endsWith('full-persistent'))await mkdir(downloads);
   const entry={mode,status:'running',sessions:[],downloads:[],events:[]};report.cases.push(entry);let context,page,stage='initial';
   const event=(type,details={})=>entry.events.push({stage,type,...details});
   const mount=async()=>{
    context=await chromium.launchPersistentContext(profile,{headless:true,acceptDownloads:true,
     ...(mode==='postfix-full-persistent'?{executablePath:postfix}:mode.startsWith('full')?{executablePath:chromium.executablePath()}:{}),
     ...(mode.endsWith('full-persistent')?{downloadsPath:downloads}:{}),
    });
    const browser=context.browser();if(mode==='postfix-full-persistent')assert.equal(browser.version(),'155.0.8059.12','Post-fix browser must match the pinned experiment.');
    const session=await browser.newBrowserCDPSession();
    try{entry.sessions.push({version:browser.version(),pids:(await session.send('SystemInfo.getProcessInfo')).processInfo.filter(p=>p.type==='browser').map(p=>p.id)});}finally{await session.detach();}
    context.on('close',()=>event('context-close'));browser.on('disconnected',()=>event('browser-disconnected'));
    page=await context.newPage();page.on('close',()=>event('page-close'));page.on('crash',()=>event('page-crash'));
    await page.setContent('<!doctype html><title>Neutral local download control</title><button id="download">Download original bytes</button>');
    // Real Blob construction and native anchor activation. Never fabricate a
    // download event or returned file. Keep bytes outside the application.
    await page.evaluate(length=>{
     const bytes=new Uint8Array(length);for(let i=0;i<length;i++)bytes[i]=(i*31+17)&255;
     const blob=new Blob([bytes],{type:'application/octet-stream'}),urls=new Set();
     document.querySelector('#download').onclick=()=>{const url=URL.createObjectURL(blob);urls.add(url);const a=document.createElement('a');a.href=url;a.download='original-control.bin';a.click();};
     addEventListener('pagehide',()=>{for(const url of urls)URL.revokeObjectURL(url);urls.clear();});
    },payload.length);
   };
   const close=async()=>{if(context){event('harness-close-request');await context.close();context=null;}};
   const download=async index=>{
    const promised=page.waitForEvent('download',{timeout:15000});await page.locator('#download').click();const file=await promised;
    const path=join(owned,`saved-${index}.bin`);await saveDownload(file,page,'#download',path);
    const bytes=await readFile(path);assert.equal(bytes.length,payload.length);assert.equal(digest(bytes),report.payload.sha256);
    entry.downloads.push({stage,index,bytes:bytes.length,sha256:digest(bytes)});await rm(path);
   };
   try{
    await mount();for(let i=0;i<initialDownloads;i++)await download(i);await close();stage='after-restart';await mount();
    assert.notDeepEqual(entry.sessions[0].pids,entry.sessions[1].pids);await download(initialDownloads);entry.status='passed';
   }catch(error){entry.status='failed';entry.failure={stage,message:error.message,cause:error.cause?.message,diagnostics:error.diagnostics,eventsBeforeCleanup:[...entry.events]};}
   finally{await close().catch(error=>event('cleanup-error',{message:error.message}));await save();}
  }
  report.status=report.cases.filter(c=>c.mode==='headless-temporary'||c.mode==='postfix-full-persistent').every(c=>c.status==='passed')?'measured':'blocked';report.summary={passed:report.cases.filter(c=>c.status==='passed').length,failed:report.cases.filter(c=>c.status==='failed').length};await save();
  if(report.status==='blocked')throw Error('A required headless/post-fix reference failed; inspect the measured report before drawing conclusions.');
 }finally{await rm(root,{recursive:true,force:true});}
 console.log(JSON.stringify({status:report.status,summary:report.summary,output:dir},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
