import { expect, test, chromium, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Company, CompanyBrief, Notebook } from '../../src/types.ts';

// Original CSV, annual snapshots, source text and IDs: no model/brief/report imports.
const DAY = '2026-10-04', DB = 'stock-notebook-v1';
const HEADER = 'ticker,name,sector,currency,fiscal_date,revenue,prior_revenue,net_income,debt,equity,filing_url';
const ROWS: Company[] = [
  { ticker: 'CITE', name: 'Original Evidence Co', sector: 'Research', currency: 'USD', fiscalDate: '2025-12-31', revenue: 100, priorRevenue: 77, netIncome: 10, debt: 20, equity: 40, filingUrl: 'https://example.com/annual-2025', sourceLine: 2 },
  { ticker: 'CITE', name: 'Original Evidence Co', sector: 'Research', currency: 'USD', fiscalDate: '2024-12-31', revenue: null, priorRevenue: 0, netIncome: -.000001, debt: 0, equity: -4, filingUrl: 'https://example.com/annual-2024', sourceLine: 3 },
  { ticker: 'OMIT', name: '<img src=x onerror=window.BAD=true>', sector: 'Research', currency: 'EUR', fiscalDate: '2025-12-31', revenue: 80, priorRevenue: 70, netIncome: -10, debt: 30, equity: 20, filingUrl: null, sourceLine: 4 },
  { ticker: 'GONE', name: 'Separate issuer', sector: 'Research', currency: 'USD', fiscalDate: '2025-12-31', revenue: 50, priorRevenue: 40, netIncome: 5, debt: 10, equity: 20, filingUrl: null, sourceLine: 5 },
];
function csv(rows = ROWS) {
  const quote = (v: string | number | null) => v === null ? '' : '"' + String(v).replaceAll('"', '""') + '"';
  return HEADER + '\n' + rows.map(r => [r.ticker,r.name,r.sector,r.currency,r.fiscalDate,r.revenue,r.priorRevenue,r.netIncome,r.debt,r.equity,r.filingUrl].map(quote).join(',')).join('\n') + '\n';
}
const CSV = csv();
const EXCERPT = '  Supplied <script>alert("literal")</script> 🧾\n\tThe source says sales may vary.  ';
const STATEMENT = '  My authored claim — requires independent review. 🏢\nSecond line.  ';
const uuid = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
function literalNotebook(): Notebook {
  const dataset = { id: uuid(1), fileName: 'original-annual.csv', importedDate: DAY, basis: 'annual-12-month' as const, units: 'currency-millions' as const, synthetic: false, companies: structuredClone(ROWS) };
  const brief: CompanyBrief = { ticker: 'CITE', statements: [{ id: uuid(3), section: 'business', text: '  Supplied statement\r\nwith CRLF and 🎵.  ', citationIds: [uuid(4),uuid(5)] }], citations: [
    { id: uuid(4), kind: 'excerpt', title: '  Literal source title  ', author: '  An author  ', publishedDate: '2025-10-01', url: 'https://example.com/source?literal=%3Cscript%3E', excerpt: '  Quoted source\r\n\twith preserved CRLF 🧾  ' },
    { id: uuid(5), kind: 'annual', fields: ['revenue','priorRevenue','netIncome','debt','equity'], snapshot: { datasetId: dataset.id,fileName:dataset.fileName,importedDate:DAY,basis:dataset.basis,units:dataset.units,synthetic:false,company:structuredClone(ROWS[1]!) } },
  ] };
  return { schemaVersion:3,id:uuid(2),title:'Independent cited research',query:'',screen:{sector:null,currency:null,filters:[],includeStale:true,sortBy:'ticker',direction:'asc'},watchlist:[],comparison:[],notes:[{ticker:'CITE',text:'The existing free-text research note stays separate.'}],briefs:[brief],dataset };
}
async function downloaded(page: Page, label: string) {
  const control = page.getByRole('button',{name:label,exact:true}); await expect(control).toBeEnabled();
  const pending = page.waitForEvent('download',{timeout:10000}); await control.click(); const file = await pending;
  return {name:file.suggestedFilename(),text:await readFile((await file.path())!,'utf8')};
}
async function backup(page: Page): Promise<Notebook> { return JSON.parse((await downloaded(page,'Download notebook backup')).text) as Notebook; }
async function saved(page: Page) { await expect(page.locator('#save-status')).toContainText('Saved locally'); }
async function csvImport(page: Page, rows=ROWS, name='independent-brief.csv') {
  await expect(page.getByLabel('Import CSV',{exact:true})).toBeEnabled();
  await page.getByLabel('Import CSV',{exact:true}).setInputFiles({name,mimeType:'text/csv',buffer:Buffer.from(csv(rows))});
  await page.getByLabel('I confirm currency millions and comparable 12-month annual periods',{exact:true}).check();
  await page.getByRole('button',{name:'Replace universe',exact:true}).click();
  await expect(page.locator('#dataset-summary')).toContainText(name);
}
async function jsonImport(page: Page, book: unknown, name='original-cited.json') {
  await expect(page.getByLabel('Import notebook backup',{exact:true})).toBeEnabled();
  await page.getByLabel('Import notebook backup',{exact:true}).setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(book))});
  await expect(page.locator('#import-review')).toBeVisible();
  await page.getByLabel('I confirm currency millions and comparable 12-month annual periods',{exact:true}).check();
  await page.getByRole('button',{name:'Replace universe',exact:true}).click();
  await expect(page.locator('#dataset-summary')).toBeVisible();
}
async function view(page: Page,ticker='CITE',excluded=false) {
  const parent=page.locator(excluded?'#exclusion-content':'#results').locator(`[data-ticker="${ticker}"]`);
  await parent.getByRole('button',{name:excluded?'View excluded evidence':'View evidence',exact:true}).click();
  await expect(page.locator('#company-brief')).toContainText(ticker);
}
async function excerpt(page: Page,title='My supplied source',text=EXCERPT) {
  await page.locator('#brief-source-title').fill(title); await page.locator('#brief-source-author').fill('Independent author');
  await page.locator('#brief-source-date').fill('2025-09-01'); await page.locator('#brief-source-url').fill('https://example.com/supplied?kind=original');
  await page.locator('#brief-source-excerpt').fill(text); await page.locator('#brief-add-excerpt').click();
  await expect(page.locator('[data-brief-citation]')).toHaveCount(1);
}
async function rawRecord(page: Page, replacement?: string): Promise<string|undefined> {
  return page.evaluate(({name,replacement})=>new Promise<string|undefined>((resolve,reject)=>{
    const request=indexedDB.open(name,1); request.onerror=()=>reject(request.error);
    request.onupgradeneeded=()=>request.result.createObjectStore('notebooks');
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('notebooks',replacement===undefined?'readonly':'readwrite'),store=tx.objectStore('notebooks');
      const read=replacement===undefined?store.get('current'):store.put(replacement,'current'); let value:string|undefined;
      read.onsuccess=()=>{if(replacement===undefined)value=read.result as string|undefined;};
      tx.oncomplete=()=>{db.close();resolve(replacement===undefined?value:replacement);};tx.onabort=()=>{db.close();reject(tx.error);};
    };
  }),{name:DB,replacement});
}
interface NativeControl { held:boolean; release:(()=>void)|null; abort:boolean; aborted:number; holdSave:boolean }
type ControlledWindow=Window&{__briefNative:NativeControl};
async function nativeControl(page:Page) {
  await page.addInitScript(()=>{
    const control:NativeControl={held:false,release:null,abort:false,aborted:0,holdSave:false};(window as unknown as ControlledWindow).__briefNative=control;
    const nativeRead=File.prototype.arrayBuffer;
    File.prototype.arrayBuffer=function(){return nativeRead.call(this).then(value=>this.name==='held-brief.json'?new Promise<ArrayBuffer>(resolve=>{control.held=true;control.release=()=>{control.held=false;control.release=null;resolve(value);};}):value);};
    const nativePut=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value:unknown,key?:IDBValidKey){const request=key===undefined?nativePut.call(this,value):nativePut.call(this,value,key);
      if(control.abort&&this.transaction.db.name==='stock-notebook-v1'){control.abort=false;request.addEventListener('success',()=>{control.aborted++;this.transaction.abort();},{once:true});}return request;};
    const transaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(names:string|string[],mode?:IDBTransactionMode,options?:IDBTransactionOptions){
      const tx=transaction.call(this,names,mode,options);
      if(this.name==='stock-notebook-v1'&&mode==='readwrite'&&control.holdSave){
        control.held=true;control.release=()=>{control.holdSave=false;control.held=false;control.release=null;};
        const keepAlive=()=>{if(!control.holdSave)return;const request=tx.objectStore('notebooks').get('current');request.addEventListener('success',keepAlive,{once:true});};keepAlive();
      }return tx;
    };
  });
}
const observations=new WeakMap<Page,{errors:string[];external:string[]}>();
test.beforeEach(async({page,baseURL})=>{
  await page.clock.setFixedTime(new Date(DAY+'T12:00:00Z'));page.on('dialog',dialog=>dialog.accept());
  const observed={errors:[] as string[],external:[] as string[]};observations.set(page,observed);
  page.on('pageerror',error=>observed.errors.push(error.message));
  page.on('request',request=>{if(new URL(request.url()).origin!==new URL(baseURL!).origin)observed.external.push(request.url());});
});
test.afterEach(async({page})=>{expect(observations.get(page)?.errors).toEqual([]);expect(observations.get(page)?.external).toEqual([]);});

test('a real imported company exposes the Company brief authoring workspace', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Import CSV', { exact: true })).toBeEnabled();
  await page.getByLabel('Import CSV', { exact: true }).setInputFiles({ name: 'independent-brief.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await page.getByLabel('I confirm currency millions and comparable 12-month annual periods', { exact: true }).check();
  await page.getByRole('button', { name: 'Replace universe', exact: true }).click();
  await page.locator('[data-ticker="CITE"]').getByRole('button', { name: 'View evidence', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Company brief/ })).toBeVisible();
  await expect(page.locator('#brief-text')).toBeVisible();
});

test('native CSV authoring preserves explicit source attachments and exact annual provenance in real downloads',async({page})=>{
  await page.goto('/');await csvImport(page);await view(page);
  await expect(page.locator('#company-brief')).toContainText('Citations do not verify claims');
  await page.getByLabel('Research note',{exact:true}).fill('Independent old note');await page.getByRole('button',{name:'Save note',exact:true}).click();
  await page.locator('#brief-text').fill(STATEMENT);await excerpt(page);
  await expect(page.locator('#brief-text')).toHaveValue(STATEMENT);
  await expect(page.locator('#brief-citation-options input:checked')).toHaveCount(0);
  await page.locator('#brief-period').selectOption('2024-12-31');
  for (const field of await page.locator('#brief-fields input').all()) await field.check();await page.locator('#brief-add-annual').click();
  await expect(page.locator('[data-brief-citation]')).toHaveCount(2);
  for (const choice of await page.locator('#brief-citation-options input').all()) await choice.check();await page.locator('#brief-save-statement').click();await saved(page);
  const book=await backup(page),brief=book.briefs[0]!;expect(book.schemaVersion).toBe(3);
  expect(brief.statements[0]?.text).toBe(STATEMENT);expect(brief.statements[0]?.citationIds).toEqual(brief.citations.map(c=>c.id));
  const supplied=brief.citations.find(c=>c.kind==='excerpt')!;expect(supplied).toMatchObject({kind:'excerpt',title:'My supplied source',author:'Independent author',publishedDate:'2025-09-01',url:'https://example.com/supplied?kind=original',excerpt:EXCERPT});
  const annual=brief.citations.find(c=>c.kind==='annual')!;expect(annual.kind).toBe('annual');if(annual.kind!=='annual')throw new Error('Expected annual evidence');
  expect(annual.fields).toEqual(['revenue','priorRevenue','netIncome','debt','equity']);expect(annual.snapshot.company).toEqual(ROWS[1]);
  expect(annual.snapshot).toMatchObject({datasetId:book.dataset.id,fileName:'independent-brief.csv',importedDate:DAY,synthetic:false,units:'currency-millions'});
  expect(book.notes).toEqual([{ticker:'CITE',text:'Independent old note'}]);
  const standalone=(await downloaded(page,'Download company brief')).text,full=(await downloaded(page,'Download research report')).text;
  for(const text of[standalone,full]){expect(text).toContain(STATEMENT);expect(text).toContain(EXCERPT);expect(text).toContain('independent-brief.csv:3');expect(text).toContain('2024-12-31');expect(text).toContain('-0.000001');for(const c of brief.citations)expect(text).toContain(c.id);}
  await page.reload();await view(page);expect(await backup(page)).toEqual(book);
  await jsonImport(page,book);expect(await backup(page)).toEqual(book);
});

test('source-only and uncited briefs are useful while cited deletion requires explicit detach and all edits undo',async({page})=>{
  await page.goto('/');await csvImport(page);await view(page);await excerpt(page);const source=(await backup(page)).briefs[0]!.citations[0]!;
  expect((await backup(page)).briefs[0]!.statements).toEqual([]);
  await page.locator('#brief-text').fill('Uncited authored risk');await page.locator('#brief-section').selectOption('risks');await page.locator('#brief-save-statement').click();
  await expect(page.locator('[data-brief-statement]')).toContainText('Uncited statement');
  await page.locator('[data-brief-statement]').getByRole('button',{name:'Edit statement',exact:true}).click();
  await page.locator('#brief-citation-options input').check();await page.locator('#brief-save-statement').click();const attached=await backup(page);
  await page.locator('[data-brief-citation]').getByRole('button',{name:'Delete citation',exact:true}).click();
  expect(await backup(page)).toEqual(attached);await expect(page.locator('#brief-status')).toContainText(/cited|referenc|detach|statement/i);
  await page.locator('[data-brief-statement]').getByRole('button',{name:'Edit statement',exact:true}).click();await page.locator('#brief-citation-options input').uncheck();await page.locator('#brief-save-statement').click();
  await page.locator('[data-brief-citation]').getByRole('button',{name:'Delete citation',exact:true}).click();expect((await backup(page)).briefs[0]!.citations).toEqual([]);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await backup(page)).briefs[0]!.citations).toEqual([source]);
  await page.getByRole('button',{name:'Redo',exact:true}).click();expect((await backup(page)).briefs[0]!.citations).toEqual([]);
  await page.locator('[data-brief-statement]').getByRole('button',{name:'Delete statement',exact:true}).click();
  await expect(page.locator('[data-brief-statement]')).toHaveCount(1);await expect(page.locator('#brief-status')).toContainText(/Delete brief|last|empty/i);
  await page.locator('#brief-delete').click();expect((await backup(page)).briefs).toEqual([]);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await backup(page)).briefs[0]?.statements[0]?.text).toBe('Uncited authored risk');
});

test('literal supplied CRLF Unicode and captured missing values survive native complete reopen without claiming verification',async({page})=>{
  const book=literalNotebook();await page.goto('/');await jsonImport(page,book);await view(page);
  expect(await backup(page)).toEqual(book);await expect(page.locator('#company-brief')).toContainText('Citations do not verify claims');
  await page.locator('[data-brief-citation]').first().locator('summary').filter({hasText:/^Inspect citation$/}).click();
  await expect(page.locator('#company-brief')).toContainText(/not fetched or verified/i);await expect(page.locator('#company-brief img')).toHaveCount(0);
  const report=(await downloaded(page,'Download company brief')).text;
  expect(report).toContain(book.briefs[0]!.statements[0]!.text);expect(report).toContain(book.briefs[0]!.citations[0]!.kind==='excerpt'?book.briefs[0]!.citations[0]!.excerpt:'');
  expect(report).toContain('original-annual.csv:3');expect(report).toContain('-0.000001');expect(report).toContain('Not supplied');
  await saved(page);expect(JSON.parse((await rawRecord(page))!)).toEqual(book);
  await page.reload();await view(page);expect(await backup(page)).toEqual(book);
});

test('company switches and unrelated source commits retain unsent forms, literal spellings and active focus',async({page})=>{
  await nativeControl(page);await page.goto('/');await csvImport(page);await view(page);await saved(page);
  await page.locator('#brief-text').fill('Unsent CITE statement');await page.locator('#brief-section').selectOption('questions');
  await page.getByLabel('Research note',{exact:true}).fill('Unsent old research note');
  await page.evaluate(()=>(window as unknown as ControlledWindow).__briefNative.holdSave=true);
  await excerpt(page);await expect.poll(()=>page.evaluate(()=>(window as unknown as ControlledWindow).__briefNative.held)).toBe(true);
  await expect(page.locator('#brief-text')).toHaveValue('Unsent CITE statement');await expect(page.getByLabel('Research note',{exact:true})).toHaveValue('Unsent old research note');
  await page.locator('#brief-text').focus();await page.locator('#brief-text').evaluate((node:HTMLTextAreaElement)=>node.setSelectionRange(5,5));
  await page.evaluate(()=>(window as unknown as ControlledWindow).__briefNative.release?.());await saved(page);await expect(page.locator('#brief-text')).toBeFocused();
  expect(await page.locator('#brief-text').evaluate((node:HTMLTextAreaElement)=>node.selectionStart)).toBe(5);
  await view(page,'GONE');await page.locator('#brief-source-title').fill('Unsent other source');await view(page);
  await expect(page.locator('#brief-text')).toHaveValue('Unsent CITE statement');await expect(page.locator('#brief-section')).toHaveValue('questions');
  await view(page,'GONE');await expect(page.locator('#brief-source-title')).toHaveValue('Unsent other source');await view(page);
  const prior=await backup(page);await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await backup(page)).toEqual(prior);
  await expect(page.locator('#brief-text')).toHaveValue('Unsent CITE statement');
  await page.locator('#brief-discard-drafts').click();await expect(page.locator('#brief-text')).toHaveValue('');
  expect(await backup(page)).toEqual(prior);
});

test('invalid supplied sources fail atomically and valid astral code-point limits are not silently truncated',async({page})=>{
  await page.goto('/');await csvImport(page);await view(page);const before=await backup(page);await saved(page);const raw=await rawRecord(page);
  await page.locator('#brief-source-title').fill('Invalid URL source');await page.locator('#brief-source-excerpt').fill('Retained source draft');await page.locator('#brief-source-url').fill('https://user:pass@example.com/private');await page.locator('#brief-add-excerpt').click();
  expect(await backup(page)).toEqual(before);expect(await rawRecord(page)).toBe(raw);await expect(page.locator('#brief-source-excerpt')).toHaveValue('Retained source draft');
  await page.locator('#brief-source-url').fill('');await page.locator('#brief-source-excerpt').fill('🧾'.repeat(4000));await page.locator('#brief-add-excerpt').click();
  expect((await backup(page)).briefs[0]?.citations[0]).toMatchObject({kind:'excerpt',excerpt:'🧾'.repeat(4000)});
  await page.locator('#brief-text').fill('🏢'.repeat(1200));await page.locator('#brief-save-statement').click();expect((await backup(page)).briefs[0]?.statements[0]?.text).toBe('🏢'.repeat(1200));
  const valid=await backup(page);await page.locator('#brief-text').fill('🏢'.repeat(1201));await page.locator('#brief-save-statement').click();expect(await backup(page)).toEqual(valid);await expect(page.locator('#brief-text')).toHaveValue('🏢'.repeat(1201));
});

test('a held real File read is permanently invalidated by changed-back brief input without replacing saved research',async({page})=>{
  await nativeControl(page);await page.goto('/');await jsonImport(page,literalNotebook());await view(page);await saved(page);const prior=await backup(page),raw=await rawRecord(page);
  await page.getByLabel('Import notebook backup',{exact:true}).setInputFiles({name:'held-brief.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...literalNotebook(),title:'Never publish this late file'}))});
  await expect.poll(()=>page.evaluate(()=>(window as unknown as ControlledWindow).__briefNative.held)).toBe(true);
  await page.locator('#brief-text').fill('Changed intent');await page.locator('#brief-text').fill('');
  await page.evaluate(()=>(window as unknown as ControlledWindow).__briefNative.release?.());
  await expect(page.locator('#import-review')).toBeHidden();expect(await backup(page)).toEqual(prior);expect(await rawRecord(page)).toBe(raw);
  await expect(page.locator('#brief-text')).toHaveValue('');
});


async function refresh(page:Page,rows:Company[],name='reviewed-brief-refresh.csv'){
  await page.getByLabel('Refresh financial data',{exact:true}).setInputFiles({name,mimeType:'text/csv',buffer:Buffer.from(csv(rows))});
  await expect(page.locator('#refresh-review')).toBeVisible();await expect(page.locator('#refresh-summary')).toContainText(name);
}
async function refreshUnits(page:Page){await page.getByLabel('I confirm the refreshed CSV uses currency millions and comparable 12-month annual periods',{exact:true}).check();}
async function losses(page:Page){const ack=page.getByLabel('I reviewed the annual periods and research that will be removed',{exact:true});if(await ack.isVisible())await ack.check();}
async function acceptRefresh(page:Page,name='reviewed-brief-refresh.csv'){
  await expect(page.getByRole('button',{name:'Apply reviewed refresh',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Apply reviewed refresh',exact:true}).click();await expect(page.locator('#dataset-summary')).toContainText(name);
}

test('provenance-only refresh never rewrites old evidence or mistakes context changes for cited fact drift',async({page})=>{
  const book=literalNotebook();book.notes=[];await page.goto('/');await jsonImport(page,book);await view(page);
  const selected=structuredClone(book.briefs[0]!);const incoming=ROWS.map((row,index)=>({...row,sourceLine:index+2}));
  incoming[1]={...incoming[1]!,filingUrl:'https://example.com/new-location'}; // exact selected values retained
  await refresh(page,incoming,'new-file-same-values.csv');await refreshUnits(page);await losses(page);
  const proposal=(await downloaded(page,'Download refresh review')).text;
  expect(proposal).toContain(selected.statements[0]!.text);expect(proposal).toContain('original-annual.csv:3');expect(proposal).toContain('new-file-same-values.csv:3');
  await acceptRefresh(page,'new-file-same-values.csv');await view(page);
  await expect(page.locator('[data-brief-citation][data-citation-state=changed]')).toHaveCount(1);
  expect((await backup(page)).briefs).toEqual([selected]);
  const report=(await downloaded(page,'Download company brief')).text;expect(report).toContain('original-annual.csv:3');expect(report).toContain('https://example.com/new-location');
});

test('brief-only changed issuers require reviewed retention and missing exact periods keep complete old citations',async({page})=>{
  const book=literalNotebook();book.notes=[];
  book.briefs.push({ticker:'GONE',statements:[{id:uuid(7),section:'questions',text:'Deleted issuer question 🧾',citationIds:[uuid(8)]}],citations:[{id:uuid(8),kind:'excerpt',title:'Deleted issuer source',author:null,publishedDate:null,url:null,excerpt:'Full removed source must remain in the proposed review.'}]});
  await page.goto('/');await jsonImport(page,book);
  const incoming=ROWS.filter(row=>row.ticker!=='GONE'&&row.fiscalDate!=='2024-12-31').map(row=>row.ticker==='CITE'?{...row,name:'Renamed supplied issuer'}:row);
  await refresh(page,incoming);const retention=page.getByRole('combobox',{name:'Research retention for CITE',exact:true});await expect(retention).toBeVisible();
  await expect(page.getByRole('button',{name:'Apply reviewed refresh',exact:true})).toBeDisabled();
  await retention.selectOption('keep');await refreshUnits(page);await losses(page);
  const proposed=(await downloaded(page,'Download refresh review')).text;
  for(const text of['Deleted issuer question 🧾','Full removed source must remain in the proposed review.',book.briefs[0]!.statements[0]!.text])expect(proposed).toContain(text);
  await acceptRefresh(page);await view(page);const final=await backup(page);expect(final.briefs).toEqual([book.briefs[0]]);
  await expect(page.locator('[data-brief-citation][data-citation-state=missing]')).toHaveCount(1);
  expect((await downloaded(page,'Download company brief')).text).toContain('2024-12-31');
  await saved(page);expect(JSON.parse((await rawRecord(page))!)).toEqual(final);
  await page.reload();await view(page);expect(await backup(page)).toEqual(final);
  await refresh(page,incoming.map(row=>row.ticker==='CITE'?{...row,name:'Another issuer label'}:row),'second-refresh.csv');
  await page.getByRole('combobox',{name:'Research retention for CITE',exact:true}).selectOption('drop');await refreshUnits(page);await losses(page);
  const dropped=(await downloaded(page,'Download refresh review')).text;expect(dropped).toContain(book.briefs[0]!.statements[0]!.text);
  await acceptRefresh(page,'second-refresh.csv');expect((await backup(page)).briefs).toEqual([]);
});

test('raw brief intent makes staged refresh permanently stale and declined draft discard preserves all unsent text',async({page})=>{
  await page.goto('/');await jsonImport(page,literalNotebook());await view(page);const prior=await backup(page);
  await refresh(page,ROWS,'draft-intent-refresh.csv');await refreshUnits(page);
  await page.locator('#brief-source-excerpt').fill('Unsent refresh-staling excerpt');await page.locator('#brief-source-excerpt').fill('');
  await expect(page.getByRole('button',{name:'Apply reviewed refresh',exact:true})).toBeDisabled();await expect(page.locator('#refresh-review')).toContainText('This review is out of date');
  await page.locator('#brief-text').fill('Keep this draft when consent is declined');
  page.removeAllListeners('dialog');page.once('dialog',dialog=>dialog.dismiss());await page.locator('#brief-discard-drafts').click();
  await expect(page.locator('#brief-text')).toHaveValue('Keep this draft when consent is declined');expect(await backup(page)).toEqual(prior);
});

test('actual IndexedDB request success followed by transaction abort preserves the prior complete brief until retry',async({page})=>{
  await nativeControl(page);await page.goto('/');await jsonImport(page,literalNotebook());await view(page);await saved(page);const before=await rawRecord(page);
  await page.evaluate(()=>(window as unknown as ControlledWindow).__briefNative.abort=true);
  await page.locator('#brief-text').fill('Uncited pending durable brief');await page.locator('#brief-save-statement').click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as ControlledWindow).__briefNative.aborted)).toBe(1);
  await expect(page.locator('#save-status')).toContainText('Not saved');expect(await rawRecord(page)).toBe(before);
  const current=await backup(page);expect(current.briefs[0]!.statements.at(-1)?.text).toBe('Uncited pending durable brief');
  await page.getByRole('button',{name:'Retry saving',exact:true}).click();await saved(page);
  expect(JSON.parse((await rawRecord(page))!)).toEqual(current);await page.reload();expect(await backup(page)).toEqual(current);
});

test('real legacy saved JSON migrates only in memory and malformed saved citation graphs remain recoverable unchanged',async({page})=>{
  await page.goto('/');const {briefs:ignored,...legacy}=literalNotebook();void ignored;const old={...legacy,schemaVersion:2};const raw=JSON.stringify(old,null,2)+'\n';
  await rawRecord(page,raw);await page.reload();await expect(page.locator('#dataset-summary')).toContainText(old.dataset.fileName);
  const migrated=await backup(page);expect(migrated.schemaVersion).toBe(3);expect(migrated.briefs).toEqual([]);expect(await rawRecord(page)).toBe(raw);
  const malformed=literalNotebook();malformed.briefs[0]!.statements[0]!.citationIds=[uuid(999)];const corrupt=JSON.stringify(malformed,null,2)+'\n';
  await rawRecord(page,corrupt);await page.reload();await expect(page.getByRole('button',{name:'Download raw saved record',exact:true})).toBeVisible();
  expect((await downloaded(page,'Download raw saved record')).text).toBe(corrupt);expect(await rawRecord(page)).toBe(corrupt);
});

test('a genuine persistent Chromium process restart retains every complete citation literal and attachment',async({baseURL})=>{
  const profile=await mkdtemp(join(tmpdir(),'stock67-brief-profile-'));let context=await chromium.launchPersistentContext(profile,{headless:true,acceptDownloads:true,executablePath:process.env.CHROMIUM_PATH});
  try{
    let page=context.pages()[0]!;page.on('dialog',dialog=>dialog.accept());await page.clock.setFixedTime(new Date(DAY+'T12:00:00Z'));await page.goto(baseURL!);await jsonImport(page,literalNotebook());await view(page);
    await page.locator('#brief-text').fill('Persisted second statement');await page.locator('#brief-section').selectOption('risks');await page.locator('#brief-save-statement').click();await saved(page);const complete=await backup(page),raw=await rawRecord(page);
    await context.close();context=await chromium.launchPersistentContext(profile,{headless:true,acceptDownloads:true,executablePath:process.env.CHROMIUM_PATH});page=context.pages()[0]!;
    await page.clock.setFixedTime(new Date(DAY+'T12:00:00Z'));await page.goto(baseURL!);await expect(page.locator('#dataset-summary')).toContainText('original-annual.csv');await view(page);
    expect(await backup(page)).toEqual(complete);expect(await rawRecord(page)).toBe(raw);
  }finally{await context.close();await rm(profile,{recursive:true,force:true});}
});

test('excluded-company keyboard authoring remains accessible and truthful at390px without fetching sources',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await csvImport(page);
  await page.locator('#query-form [name=query]').fill('companies with profitable');await page.getByRole('button',{name:'Interpret criteria',exact:true}).click();await page.getByRole('button',{name:'Apply filters',exact:true}).click();
  await page.getByRole('tab',{name:'Excluded companies',exact:true}).click();await view(page,'OMIT',true);
  await page.locator('#brief-text').focus();await page.keyboard.type('An excluded company remains researchable');await page.locator('#brief-save-statement').focus();await page.keyboard.press('Enter');
  await expect(page.locator('[data-brief-statement]')).toContainText('Uncited statement');
  const report=(await downloaded(page,'Download research report')).text;expect(report).toContain('An excluded company remains researchable');
  await expect(page.locator('#company-brief img')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.locator('#brief-source-title').focus();await expect(page.locator('#brief-source-title')).toBeFocused();
});


test('UTC date turnover never silently repairs a future source date; only a new explicit save admits it',async({page})=>{
  await page.goto('/');await csvImport(page);await view(page);const before=await backup(page);
  await page.locator('#brief-source-title').fill('A dated source');await page.locator('#brief-source-date').fill('2026-10-05');await page.locator('#brief-source-excerpt').fill('The author supplies the publication date explicitly.');
  await page.locator('#brief-add-excerpt').click();expect(await backup(page)).toEqual(before);await expect(page.locator('#brief-source-date')).toHaveValue('2026-10-05');
  await page.clock.setFixedTime(new Date('2026-10-05T12:00:00Z'));expect(await backup(page)).toEqual(before);
  await page.locator('#brief-add-excerpt').click();expect((await backup(page)).briefs[0]?.citations[0]).toMatchObject({kind:'excerpt',publishedDate:'2026-10-05'});
});
