import {test as base, expect, type Page, type BrowserContext} from '@playwright/test';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {credentials, viewImage} from './image-evidence-fixtures';

// Original literal ledgers/JPEGs are authored in the smoke fixture before any
// archive producer was inspected. No mocked HTTP or application state injection.
// Raw capabilities must not appear in retained traces, videos or screenshots.
const execute=promisify(execFile),app=resolve(import.meta.dirname,'../..');
const python=process.env.FRIENDLY_PYTHON||'python3';
const sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
interface Evidence {id:string; image?:{sha256:string}; late:boolean}
interface State {id:string;revision:number;status:string;events:unknown[];evidence:Evidence[]}
interface Fixture {id:string;seats:Record<string,string>;record:{schemaVersion:number;state:State}}
interface Library {origin:string;fixtures:Fixture[];restart():Promise<void>}
const serverCode=`import sys,signal,threading
from pathlib import Path
from challenges.server import create_server
server=create_server(Path(sys.argv[1]),port=int(sys.argv[2]))
print(server.server_address[1],flush=True)
signal.signal(signal.SIGTERM,lambda *_:threading.Thread(target=server.shutdown,daemon=True).start())
try:server.serve_forever(poll_interval=.05)
finally:server.server_close()
`;
async function service(directory:string,port=0){
  const child=spawn(python,['-c',serverCode,directory,String(port)],{cwd:app,stdio:['ignore','pipe','ignore']});
  const stop=async()=>{if(child.exitCode!==null)return;await new Promise<void>((done,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Owned service did not stop in time.'));},10000);
    child.once('exit',()=>{clearTimeout(timer);done();});child.kill('SIGTERM');
  });};
  try{
    const actual=await new Promise<number>((done,reject)=>{
      let output='';const timer=setTimeout(()=>reject(Error('Owned service did not become ready.')),15000);
      child.once('exit',()=>{clearTimeout(timer);reject(Error('Owned service failed before readiness.'));});
      child.stdout.on('data',(chunk:Buffer)=>{output+=chunk.toString();if(output.includes('\n')){clearTimeout(timer);const line=output.split('\n')[0];if(/^\d+$/.test(line))done(Number(line));else reject(Error('Unexpected service readiness response.'));}});
    });
    return{origin:`http://127.0.0.1:${actual}`,port:actual,stop};
  }catch(error){await stop();throw error;}
}
async function archiveCli(args:string[],fixtures:Fixture[]){
  let result:{stdout:string;stderr:string};
  try{result=await execute(python,['-m','challenges.backup',...args],{cwd:app,timeout:320000,maxBuffer:65536});}
  catch{throw Error(`Actual archive CLI ${args[0]} failed; potentially private diagnostics withheld.`);}
  expect(fixtures.every(f=>Object.values(f.seats).every(token=>!(result.stdout+result.stderr).includes(token)))).toBe(true);
}
const test=base.extend<{library:Library}>({
  library:async({browserName},use)=>{
    expect(browserName).toBe('chromium');
    const parent=await mkdtemp(join(tmpdir(),'friendly103-native-')),root=join(parent,'fixture');
    let active:Awaited<ReturnType<typeof service>>|undefined;
    try{
      await execute(python,['scripts/smoke_library_archive.py','--fixtures-only','--profile','browser','--output',root],{cwd:app,timeout:30000});
      const fixtures=JSON.parse(await readFile(join(root,'private-fixture.json'),'utf8')) as Fixture[];
      active=await service(join(root,'source'));
      for(const fixture of fixtures){
        const response=await fetch(`${active.origin}/api/challenges/${fixture.id}`,{headers:{Authorization:`Bearer ${fixture.seats.proposer}`}});
        expect(response.status).toBe(200);const body=await response.json();delete body.serverTime;delete body.myRole;
        expect(body).toEqual({...fixture.record.state,deadlinePassed:true});
      }
      await active.stop();active=undefined;
      const archive=join(root,'library.zip');
      await archiveCli(['create','--data-dir',join(root,'source'),'--output',archive],fixtures);
      await archiveCli(['inspect','--archive',archive],fixtures);
      await archiveCli(['restore','--archive',archive,'--data-dir',join(root,'restored')],fixtures);
      // Independent SQLite raw TEXT/JPEG equality before intentional new claims.
      await execute(python,['-c',`import importlib.util,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('original_fixture',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
p=Path(sys.argv[2]);expected=json.loads((p/'frozen-expectations.json').read_text())
assert m.fingerprints(p/'source')==m.fingerprints(p/'restored')=={k:expected[k] for k in ('records','images')}
assert m.sha((p/'source/challenges.sqlite3').read_bytes())==expected['sourceDatabaseSha256']
`,join(app,'scripts/smoke_library_archive.py'),root],{cwd:app,timeout:15000});
      active=await service(join(root,'restored'));const origin=active.origin,port=active.port;
      await use({origin,fixtures,restart:async()=>{await active!.stop();active=await service(join(root,'restored'),port);}});
    }finally{await active?.stop();await rm(parent,{recursive:true,force:true});}
  },
});
test.use({trace:'off',video:'off',screenshot:'off'});
// Playwright can retain an error-context DOM even with tracing disabled. Retire
// private-link pages before automatic context-close snapshots on success/failure.
async function retirePage(page:Page){await page.goto('about:blank',{timeout:5000}).catch(()=>{});}
async function retireContext(context:BrowserContext){for(const page of context.pages())await retirePage(page);await context.close();}
test.afterEach(async({page})=>{await retirePage(page);});
async function link(page:Page,library:Library,fixture:Fixture,kind:'access'|'invite'|'arbiter',token:string){
  await page.goto(library.origin);
  // Avoid exposing a raw fragment in a goto step's title or failure diagnostic.
  await page.evaluate(({id,kind,token})=>{location.assign(`/?challenge=${id}#${kind}=${token}`);},{id:fixture.id,kind,token});
  await expect.poll(()=>new URL(page.url()).hash).toBe('');
}
async function openSeat(page:Page,library:Library,fixture:Fixture,role:string){
  await link(page,library,fixture,'access',fixture.seats[role]);
  await page.getByRole('button',{name:'Use this private access link',exact:true}).click();
  await expect(page.locator('#challenge-revision')).toContainText(`Revision ${fixture.record.state.revision} ·`);
  const saved=await credentials(page);expect(saved.id).toBe(fixture.id);expect(saved.token===fixture.seats[role]).toBe(true);
  const response=await page.request.get(`${library.origin}/api/challenges/${fixture.id}`,{headers:{Authorization:`Bearer ${saved.token}`}});
  const state=await response.json();expect(state.myRole).toBe(role);delete state.myRole;delete state.serverTime;
  expect(state).toEqual({...fixture.record.state,deadlinePassed:true});
}
async function download(page:Page,name:string){
  const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();
  const file=await pending;return readFile((await file.path())!);
}
async function post(page:Page,library:Library,fixture:Fixture,path:string,data:Record<string,unknown>){
  return page.request.post(`${library.origin}/api/challenges/${fixture.id}/${path}`,{headers:{Origin:library.origin},data});
}

test('archive restores original seats, literal public exports and exact JPEGs across restart',async({browser,library})=>{
  const fixture=library.fixtures[0];
  for(const role of ['proposer','opponent','arbiter']){
    const context=await browser.newContext(),page=await context.newPage();
    try{
      await openSeat(page,library,fixture,role);await expect(page.locator('#challenge-status')).toContainText(/resolved/i);
      const raw=await download(page,'Export record'),record=JSON.parse(raw.toString());
      expect(Number.isSafeInteger(record.exportedAt)).toBe(true);delete record.exportedAt;
      expect(record).toEqual({schemaVersion:2,challenge:{...fixture.record.state,deadlinePassed:true}});
      for(const evidence of fixture.record.state.evidence){
        const bytes=await viewImage(page,evidence.id);expect(sha(bytes)).toBe(evidence.image!.sha256);
        await page.getByRole('button',{name:'Close retained image',exact:true}).click();
      }
      const html=await download(page,'Export record with images');
      expect(Object.values(fixture.seats).every(token=>!raw.includes(token)&&!html.includes(token))).toBe(true);
      const literal=await page.evaluate(text=>{
        const doc=new DOMParser().parseFromString(text,'text/html');
        return{record:JSON.parse(doc.querySelector('pre')!.textContent!),images:[...doc.querySelectorAll('img')].map(image=>image.getAttribute('src')!),scripts:doc.querySelectorAll('script').length};
      },html.toString());
      delete literal.record.exportedAt;expect(literal.record).toEqual(record);expect(literal.scripts).toBe(0);
      expect(literal.images.map(value=>sha(Buffer.from(value.split(',')[1],'base64')))).toEqual(fixture.record.state.evidence.map(item=>item.image!.sha256));
    }finally{await retireContext(context);}
  }
  await library.restart();const context=await browser.newContext();
  try{await openSeat(await context.newPage(),library,fixture,'arbiter');}finally{await retireContext(context);}
});

test('archive pending opponent is claimable once but expired terms stay unaccepted',async({page,library})=>{
  const fixture=library.fixtures[1];await link(page,library,fixture,'invite',fixture.seats.opponentInvite);
  await page.locator('#claim-form [name=name]').fill('Sam');await page.getByRole('button',{name:'Claim opponent seat',exact:true}).click();
  await expect(page.locator('#challenge-revision')).toContainText('Revision 2 ·');const seat=await credentials(page);
  const repeated=await post(page,library,fixture,'join',{name:'Sam',inviteToken:fixture.seats.opponentInvite});expect(repeated.ok()).toBe(false);
  const accept=await page.request.post(`${library.origin}/api/challenges/${fixture.id}/accept`,{headers:{Authorization:`Bearer ${seat.token}`,Origin:library.origin},data:{revision:2,termsVersion:1}});
  expect(accept.status()).toBe(409);
  const state=await(await page.request.get(`${library.origin}/api/challenges/${fixture.id}`,{headers:{Authorization:`Bearer ${seat.token}`}})).json();
  expect(state.status).toBe('proposed');expect(state.revision).toBe(2);expect(state.deadlinePassed).toBe(true);expect(state.acceptedAt).toBeNull();
});

test('archive arbiter invitation preserves consent, rejects withdrawn token and is consumed once',async({page,library})=>{
  const fixture=library.fixtures[2];
  const old=await post(page,library,fixture,'arbiter/join',{name:'Taylor',inviteToken:fixture.seats.withdrawnInvite});expect(old.ok()).toBe(false);
  await link(page,library,fixture,'arbiter',fixture.seats.arbiterInvite);await page.locator('#claim-form [name=name]').fill('Taylor');
  await page.getByRole('button',{name:'Claim arbiter seat',exact:true}).click();
  await expect(page.locator('#challenge-revision')).toContainText(`Revision ${fixture.record.state.revision+1} ·`);
  const repeated=await post(page,library,fixture,'arbiter/join',{name:'Taylor',inviteToken:fixture.seats.arbiterInvite});expect(repeated.ok()).toBe(false);
  const seat=await credentials(page);await library.restart();await page.reload();
  const state=await(await page.request.get(`${library.origin}/api/challenges/${fixture.id}`,{headers:{Authorization:`Bearer ${seat.token}`}})).json();
  expect(state.myRole).toBe('arbiter');expect(state.status).toBe('disputed');expect(state.deadlinePassed).toBe(true);
  expect(state.events.slice(0,-1)).toEqual(fixture.record.state.events);
});

test('archive consumed invitations stay rejected and resolved decisions stay immutable',async({page,library})=>{
  const fixture=library.fixtures[0];await openSeat(page,library,fixture,'arbiter');
  for(const[path,key,name]of[['join','opponentInvite','Sam'],['arbiter/join','arbiterInvite','Taylor']]){
    const response=await post(page,library,fixture,path,{name,inviteToken:fixture.seats[key]});expect(response.ok()).toBe(false);
  }
  const response=await page.request.post(`${library.origin}/api/challenges/${fixture.id}/arbiter/decide`,{headers:{Authorization:`Bearer ${fixture.seats.arbiter}`,Origin:library.origin},data:{revision:fixture.record.state.revision,outcome:'proposer',reason:'Attempted changed decision.'}});
  expect(response.status()).toBe(409);
  const state=await(await page.request.get(`${library.origin}/api/challenges/${fixture.id}`,{headers:{Authorization:`Bearer ${fixture.seats.arbiter}`}})).json();
  delete state.serverTime;delete state.myRole;expect(state).toEqual({...fixture.record.state,deadlinePassed:true});
});
