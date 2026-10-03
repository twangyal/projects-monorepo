import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';

test('real WebGL scene renders, edits survive reload, invalid import preserves film',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Ready');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:info.outputPath('desktop.png'),fullPage:true});
  const colors=await page.locator('#stage').evaluate(c=>{
    const copy=document.createElement('canvas');copy.width=c.width;copy.height=c.height;
    const ctx=copy.getContext('2d');ctx.drawImage(c,0,0);
    const pixels=ctx.getImageData(0,0,copy.width,copy.height).data,set=new Set();
    for(let i=0;i<pixels.length;i+=64)set.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]}`);
    return set.size;
  });
  expect(colors).toBeGreaterThan(8);
  await page.getByLabel('Film title').fill('My arrival');await page.getByLabel('Film title').press('Tab');
  await page.getByLabel('Performer X').fill('2');await page.getByLabel('Performer X').press('Tab');
  await page.getByRole('button',{name:'Add shot',exact:true}).click();
  await expect(page.locator('#shots button')).toHaveCount(3);
  await page.reload();await expect(page.getByLabel('Film title')).toHaveValue('My arrival');
  await expect(page.getByLabel('Performer X')).toHaveValue('2');
  await page.locator('#import').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"schemaVersion":99}')});
  await expect(page.locator('#status')).toContainText('Invalid');
  await expect(page.getByLabel('Film title')).toHaveValue('My arrival');
  await expect(page.locator('#shots button')).toHaveCount(3);expect(errors).toEqual([]);
});
test('rehearsal scrubs and exports an actually playable bounded video',async({page},info)=>{
  await page.goto('/');
  // Two one-second shots for a short real encoder test.
  for(let i=0;i<2;i++){
    await page.locator('#shots button').nth(i).click();
    await page.getByLabel('Shot duration').fill('1');await page.getByLabel('Shot duration').press('Tab');
  }
  await page.getByRole('button',{name:'Rehearse',exact:true}).click();
  await expect(page.locator('#time')).toContainText('2.00', {timeout:10000});
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export WebM',exact:true}).click();
  const file=await download,path=info.outputPath('film.webm');await file.saveAs(path);
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],{encoding:'utf8'}));
  expect(probe.streams.some(s=>s.codec_type==='video'&&s.width===960&&s.height===540)).toBeTruthy();
  expect(Number(probe.format.duration)).toBeGreaterThan(1.4);
  expect(Number(probe.format.duration)).toBeLessThan(4);
  await expect(page.getByRole('button',{name:'Rehearse',exact:true})).toBeEnabled();
});
test('desktop/mobile controls work and lack of headset has an honest message',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.screenshot({path:info.outputPath('mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Enter VR',exact:true}).click();
  await expect(page.locator('#status')).toContainText(/VR|headset/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  await page.getByRole('button',{name:'Save project',exact:true}).click();
  await page.getByRole('button',{name:'Remove shot',exact:true}).click();
  await expect(page.locator('#shots button')).toHaveCount(1);
  await page.getByRole('button',{name:'Remove shot',exact:true}).click();
  await expect(page.locator('#shots button')).toHaveCount(1);
});
