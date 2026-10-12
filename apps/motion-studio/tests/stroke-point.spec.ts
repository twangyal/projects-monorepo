import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {PNG} from 'pngjs';
import {parseGIF,decompressFrames} from 'gifuct-js';
import {originalStrokeProject,type OracleProject} from './stroke-edit-fixtures.ts';
import {nativeCurrent} from './native-saved-project.ts';
async function bytes(page:Page,id='#backup'){const pending=page.waitForEvent('download');await page.locator(id).click();return readFile((await (await pending).path())!);}
async function backup(page:Page){return JSON.parse((await bytes(page)).toString()) as OracleProject;}
async function open(page:Page){const p=originalStrokeProject(true);await page.goto('/');await expect(page.locator('#project-file')).toBeEnabled();await page.locator('#project-file').setInputFiles({name:'point.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await expect.poll(()=>nativeCurrent(page)).toEqual(p);await page.locator('#layers button').filter({hasText:'Paint'}).click();await page.getByRole('button',{name:'Edit strokes',exact:true}).click();await page.getByRole('button',{name:'Stroke 1',exact:true}).click();return p;}
test('reshape a vertex changes rendered ink and retains complete history and reload',async({page})=>{
 const p=await open(page);await expect(page.locator('#stroke-point')).toBeVisible({timeout:1000});await page.locator('#stroke-point').selectOption('1');await expect(page.locator('#stroke-point-x')).toHaveValue('60');await page.locator('#stroke-point-y').fill('40');expect(await backup(page)).toEqual(p);await page.locator('#stroke-point-apply').click();const expected=structuredClone(p);expected.layers[0].cels[0].strokes[0].points[1]={x:60,y:40};expect(await backup(page)).toEqual(expected);
 const png=PNG.sync.read(await bytes(page,'#png'));const at=(200*640+320)*4;expect(Array.from(png.data.subarray(at,at+4))).toEqual([255,0,0,255]);
 const raw=await bytes(page,'#gif'),gif=parseGIF(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)),frames=decompressFrames(gif,true);expect(frames).toHaveLength(12);expect(Array.from(frames[0].patch.subarray(at,at+4))).toEqual([255,0,0,255]);expect(Array.from(frames[5].patch.subarray(at,at+4))).toEqual([255,0,0,255]);expect(Array.from(frames[6].patch.subarray(at,at+4))).toEqual([255,255,255,255]);
 await page.locator('#undo').click();expect(await backup(page)).toEqual(p);await page.getByRole('button',{name:'Stroke 1',exact:true}).click();await page.locator('#stroke-point').selectOption('1');await page.locator('#stroke-point-apply').click();await expect(page.locator('#redo')).toBeEnabled();expect(await backup(page)).toEqual(p);await page.locator('#redo').click();expect(await backup(page)).toEqual(expected);await expect.poll(()=>nativeCurrent(page)).toEqual(expected);await page.reload();expect(await backup(page)).toEqual(expected);
});
test('point drafts refuse invalid coordinates and protect other raw fields at390px',async({page})=>{
 await page.setViewportSize({width:390,height:844});const p=await open(page);await expect(page.locator('#stroke-point-x')).toBeVisible({timeout:1000});await page.locator('#stroke-point-x').fill('7e-');await page.locator('#stroke-point-apply').click();await expect(page.locator('#stroke-point-x')).toHaveValue('7e-');expect(await backup(page)).toEqual(p);await expect(page.locator('#stroke-forward')).toBeDisabled();await page.locator('#stroke-point').dispatchEvent('change');await expect(page.locator('#stroke-point-x')).toHaveValue('7e-');await page.locator('#stroke-point-x').fill('1281');await page.locator('#stroke-point-apply').click();expect(await backup(page)).toEqual(p);await page.locator('#stroke-discard').click();await expect(page.locator('#stroke-point-x')).toHaveValue('-60');
 const raw=page.locator('#pose-x');await raw.fill('321');await page.locator('#stroke-point-apply').click();await expect(raw).toHaveValue('321');await expect(raw).toBeFocused();expect(await nativeCurrent(page)).toEqual(p);await page.locator('#discard-pose-edits').click();await page.getByRole('button',{name:'Stroke 1',exact:true}).click();await page.locator('#stroke-point-y').fill('40');await page.locator('#stroke-point-apply').focus();await page.keyboard.press('Enter');const expected=structuredClone(p);expected.layers[0].cels[0].strokes[0].points[0]={x:-60,y:40};expect(await backup(page)).toEqual(expected);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('#stroke-editor').scrollIntoViewIfNeeded();await page.locator('#stroke-points').screenshot({path:test.info().outputPath('stroke-point-mobile.png')});
});
test('point labels and coordinate inputs cannot blur-commit an unrelated raw pose draft',async({page})=>{
 const p=await open(page),raw=page.locator('#pose-x');await raw.fill('321');
 for(const label of ['Selected point','Point local X','Point local Y']){
  await page.locator('#stroke-points label').filter({hasText:label}).click();await expect(raw).toBeFocused();await expect(raw).toHaveValue('321');expect(await nativeCurrent(page)).toEqual(p);
 }
 await page.locator('#stroke-point-x').click();await expect(raw).toBeFocused();expect(await nativeCurrent(page)).toEqual(p);
});

test('selected point ring uses the layer rotated scaled pose without entering exported artwork',async({page})=>{
 const p=await open(page);p.layers[0].keys[0].rotation=90;p.layers[0].keys[0].scale=2;
 const dialog=(d:import('@playwright/test').Dialog)=>d.accept();page.on('dialog',dialog);await page.locator('#project-file').setInputFiles({name:'rotated.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await expect.poll(()=>nativeCurrent(page)).toEqual(p);page.off('dialog',dialog);await page.locator('#layers button').filter({hasText:'Paint'}).click();await page.getByRole('button',{name:'Stroke 1',exact:true}).click();await page.locator('#stroke-point').selectOption('1');
 const data=await page.locator('#stroke-overlay').evaluate((c:HTMLCanvasElement)=>c.toDataURL());const png=PNG.sync.read(Buffer.from(data.split(',')[1],'base64'));
 // Literal local(60,0), 90deg, scale2, translation(320,180) => stage(320,300).
 const alpha=(x:number,y:number)=>png.data[(y*640+x)*4+3];expect(alpha(326,300)).toBeGreaterThan(0);expect(alpha(314,300)).toBeGreaterThan(0);expect(alpha(326,60)).toBe(0);expect(alpha(320,300)).toBe(0);expect(await backup(page)).toEqual(p);
});
