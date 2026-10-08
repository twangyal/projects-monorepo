import {expect} from '@playwright/test';
import {test,openTiming,fromServer,editorCues} from './sequential-timing-fixtures';

for(const kind of ['malformed','missing fields','wrong clip','wrong saved words','wrong revision'] as const){
 test(`unconfirmed ${kind} Save reply preserves complete lyric work and history`,async({page,request,timingClips})=>{
  const clip=await timingClips.create();await openTiming(page,clip);
  await page.locator('#title').fill('Unsent title café 🌓');
  await page.getByLabel('Lyric line 1',{exact:true}).fill('Literal edited words <kept>');
  const cues=await editorCues(page);let puts=0;
  page.on('request',request=>{if(request.method()==='PUT'&&new URL(request.url()).pathname===`/api/projects/${clip.id}`)puts++;});
  await page.route(`**/api/projects/${clip.id}`,async route=>{
   if(route.request().method()!=='PUT'){await route.continue();return;}
   const response=await route.fetch();const committed=await response.json();
   if(kind==='malformed'){await route.fulfill({status:200,contentType:'application/json',body:'{"id":'});return;}
   const value=kind==='missing fields'?{}:kind==='wrong clip'?{...committed,id:'f'.repeat(32)}:kind==='wrong saved words'?{...committed,cues:clip.cues}:{...committed,revision:clip.revision};
   await route.fulfill({status:200,json:value});
  },{times:1});
  await page.locator('#save').click();
  await expect(page.locator('#message')).toContainText('unconfirmed');
  await expect(page.locator('#title')).toHaveValue('Unsent title café 🌓');expect(await editorCues(page)).toEqual(cues);
  await expect(page.locator('#save-state')).toContainText('Unsaved lyric edits');
  await expect(page.locator('#undo-lyrics')).toBeEnabled();expect(puts).toBe(1);
  const saved=await fromServer(request,clip.id);expect(saved.title).toBe('Unsent title café 🌓');expect(saved.cues).toEqual(cues);
  await page.locator('#undo-lyrics').click();await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue(clip.cues[0].text);
  await page.locator('#redo-lyrics').click();expect(await editorCues(page)).toEqual(cues);
  // Deliberate Save checks the server's revision rather than automatically replaying.
  await page.locator('#save').click();await expect(page.locator('#message')).toContainText('revision is stale');expect(puts).toBe(2);
  page.once('dialog',dialog=>dialog.accept());await page.reload();
  await expect(page.locator('#title')).toHaveValue(saved.title);expect(await editorCues(page)).toEqual(cues);
  await page.getByLabel('Lyric line 1',{exact:true}).fill('A deliberate later correction');await page.locator('#save').click();
  await expect(page.locator('#message')).toContainText('saved locally');await expect(page.locator('#undo-lyrics')).toBeDisabled();
 });
}
