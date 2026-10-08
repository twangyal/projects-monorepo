import {test,expect} from '@playwright/test';
import {seats,cleanup,snapshot} from './saved-mixes-fixtures';
const literal='Literal <memory> café 🌓';
for(const corruption of ['malformed','missing-fields','wrong-room','missing-memory','wrong-text']){
 test(`a ${corruption} memory acknowledgment keeps exact input without repeating POST`,async({page,browser,baseURL})=>{
  const state=await seats(page,browser,baseURL);
  try{
   let posts=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/memories'))posts++;});
   await page.route('**/api/rooms/*/memories',async route=>{
    const response=await route.fetch(),value=await response.json();expect(response.status()).toBe(200);
    if(corruption==='wrong-room')value.id='f'.repeat(32);
    if(corruption==='missing-memory')value.memories=[];
    if(corruption==='wrong-text')value.memories.at(-1).text='Other words';
    await route.fulfill({response,contentType:'application/json',body:corruption==='malformed'?'{"id":':JSON.stringify(corruption==='missing-fields'?{}:value)});
   },{times:1});
   await page.locator('#memory-track').selectOption(state.ids[0]);await page.locator('#memory-date').fill('2026-10-08');await page.locator('#memory-text').fill(literal);await page.locator('#add-memory').click();
   await expect(page.locator('#notice')).toContainText(/unconfirmed/i);await expect(page.locator('#memory-text')).toHaveValue(literal);await expect(page.locator('#add-memory')).toBeEnabled();
   await expect.poll(async()=> (await snapshot(page)).memories.length).toBe(1);
   await page.waitForTimeout(1200);expect(posts).toBe(1);await expect(page.locator('#memory-text')).toHaveValue(literal);
   // Recovery is an explicit new choice, using different text; the first commit remains once.
   await page.locator('#memory-text').fill('Second deliberate memory');await page.locator('#add-memory').click();await expect(page.locator('#memory-text')).toHaveValue('');expect(posts).toBe(2);
   const final=await snapshot(page);expect(final.memories).toHaveLength(2);expect(final.memories[0]).toMatchObject({text:literal,date:'2026-10-08',trackId:state.ids[0]});
  }finally{await cleanup(page);await state.close();}
 });
}
test('invalid room-note exports never download or claim a successful backup',async({page,browser,baseURL})=>{
 const state=await seats(page,browser,baseURL);
 try{
  let downloads=0;page.on('download',()=>downloads++);
  await page.route('**/api/rooms/*/export',async route=>{const response=await route.fetch();await route.fulfill({response,json:{schemaVersion:2,id:'f'.repeat(32)}});},{times:1});
  await page.locator('#room-export').click();await expect(page.locator('#notice')).toContainText(/unconfirmed/i);expect(downloads).toBe(0);
  const download=page.waitForEvent('download');await page.locator('#room-export').click();expect((await download).suggestedFilename()).toMatch(/\.json$/);expect(downloads).toBe(1);
 }finally{await cleanup(page);await state.close();}
});
