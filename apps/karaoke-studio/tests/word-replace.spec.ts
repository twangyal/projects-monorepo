import {expect,type Page} from '@playwright/test';
import {test,openTiming,fromServer} from './sequential-timing-fixtures';
async function fill(page:Page,find:string,replacement:string){await page.getByLabel('Literal text to replace',{exact:true}).fill(find);await page.getByLabel('Replacement lyric text',{exact:true}).fill(replacement);}
test('preview and one Apply retain raw timing title paste history and exact saved reopened words',async({page,timingClips,request})=>{
 const original=[{start:0,end:1,text:'café 🌓 café 🌓'},{start:2,end:5,text:'Other café 🌓'}],project=await timingClips.create(original);await openTiming(page,project);
 await page.getByLabel('End line 1',{exact:true}).fill('1.000');await page.getByLabel('Start line 2',{exact:true}).fill('2.000');
 await page.getByLabel('Clip title').fill('Title draft');await page.getByLabel('Paste lyrics, one line per cue').fill('Unapplied words');
 await page.getByText('Replace lyric words',{exact:true}).click();await fill(page,'café 🌓','$&');
 await expect(page.locator('#words-replace-summary')).toContainText('3 matches across 2 changed lines');
 await expect(page.locator('#words-replace-preview')).toContainText('Other $&');await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue(original[0].text);
 expect((await fromServer(request,project.id)).cues).toEqual(original);
 await page.getByRole('button',{name:'Apply lyric word replacements',exact:true}).click();
 await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('$& $&');await expect(page.getByLabel('End line 1',{exact:true})).toHaveValue('1.000');await expect(page.getByLabel('Start line 2',{exact:true})).toHaveValue('2.000');
 await expect(page.getByLabel('Clip title')).toHaveValue('Title draft');await expect(page.getByLabel('Paste lyrics, one line per cue')).toHaveValue('Unapplied words');await expect(page.getByLabel('Literal text to replace',{exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue(original[0].text);
 await page.getByRole('button',{name:'Redo lyric edit',exact:true}).click();await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('$& $&');
 await page.getByRole('button',{name:'Discard pasted draft',exact:true}).click();await page.getByRole('button',{name:'Save lyrics',exact:true}).click();await expect(page.locator('#message')).toContainText('saved locally');
 expect((await fromServer(request,project.id)).cues).toEqual([{...original[0],text:'$& $&'},{...original[1],text:'Other $&'}]);await page.reload();await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('$& $&');
});
test('refusals no-match no-op and changed preview retain Redo and current fields on a phone',async({page,timingClips})=>{
 await page.setViewportSize({width:390,height:740});await openTiming(page,await timingClips.create([{start:0,end:1,text:'word'},{start:2,end:4,text:'word again'}]));
 await page.getByLabel('Clip title').fill('New title');await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();await expect(page.getByRole('button',{name:'Redo lyric edit',exact:true})).toBeEnabled();
 await page.getByText('Replace lyric words',{exact:true}).click();await fill(page,'word','word');await expect(page.getByRole('button',{name:'Apply lyric word replacements',exact:true})).toBeDisabled();
 await fill(page,'absent','new');await expect(page.locator('#words-replace-summary')).toContainText('No matching');await expect(page.getByRole('button',{name:'Redo lyric edit',exact:true})).toBeEnabled();
 await fill(page,'word','');await expect(page.locator('#words-replace-summary')).toContainText('Line 1');await expect(page.getByRole('button',{name:'Apply lyric word replacements',exact:true})).toBeDisabled();
 await fill(page,'word','new');await page.getByLabel('End line 1',{exact:true}).fill('');await expect(page.getByRole('button',{name:'Apply lyric word replacements',exact:true})).toBeDisabled();await expect(page.getByLabel('End line 1',{exact:true})).toHaveValue('');
 await page.getByLabel('End line 1',{exact:true}).fill('1.000');await page.getByLabel('Lyric line 2',{exact:true}).fill('Changed');await expect(page.locator('#words-replace-summary')).toContainText('1 match across 1 changed line');
 await page.getByRole('button',{name:'Apply lyric word replacements',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('new');await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue('Changed');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('preview and no-op preserve native practice while Apply retires practice and timing ownership',async({page,timingClips})=>{
 await openTiming(page,await timingClips.create([{start:0,end:2,text:'word'},{start:3,end:5,text:'word again'}]));
 await page.getByText('Practice a lyric range',{exact:true}).click();await page.getByRole('button',{name:'Repeat range',exact:true}).click();
 await expect.poll(()=>page.locator('#audio').evaluate(e=>(e as HTMLAudioElement).paused)).toBe(false);
 await page.getByText('Replace lyric words',{exact:true}).click();await fill(page,'word','word');
 await expect(page.getByRole('button',{name:'Apply lyric word replacements',exact:true})).toBeDisabled();expect(await page.locator('#audio').evaluate(e=>(e as HTMLAudioElement).paused)).toBe(false);
 await fill(page,'word','');await expect(page.getByRole('button',{name:'Apply lyric word replacements',exact:true})).toBeDisabled();expect(await page.locator('#audio').evaluate(e=>(e as HTMLAudioElement).paused)).toBe(false);
 await fill(page,'word','new');await page.getByRole('button',{name:'Apply lyric word replacements',exact:true}).click();await expect.poll(()=>page.locator('#audio').evaluate(e=>(e as HTMLAudioElement).paused)).toBe(true);
 await page.getByText('Time lines while listening',{exact:true}).click();await page.getByRole('button',{name:'Begin timing session',exact:true}).click();await expect(page.locator('#timing-cancel')).toBeEnabled();
 await fill(page,'new','final');await expect(page.locator('#timing-cancel')).toBeEnabled();await page.getByRole('button',{name:'Apply lyric word replacements',exact:true}).click();await expect(page.locator('#timing-cancel')).toBeDisabled();
 await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('final');
});
test('switching clips clears replacement utilities without changing either saved song',async({page,timingClips,request})=>{
 const first=await timingClips.create([{start:0,end:1,text:'first'}]),second=await timingClips.create([{start:0,end:1,text:'second'}]);await openTiming(page,first);
 await page.getByText('Replace lyric words',{exact:true}).click();await fill(page,'first','draft');
 await page.locator('#projects').selectOption(second.id);await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('second');await expect(page.getByLabel('Literal text to replace',{exact:true})).toHaveValue('');await expect(page.getByLabel('Replacement lyric text',{exact:true})).toHaveValue('');
 expect((await fromServer(request,first.id)).cues[0].text).toBe('first');expect((await fromServer(request,second.id)).cues[0].text).toBe('second');
});
