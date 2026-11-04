import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('longer settling runs a real worker and records matched comparison settings',async({page},info)=>{
  test.setTimeout(240000);
  await page.setViewportSize({width:390,height:850});
  await page.goto('/');
  await page.getByRole('button',{name:'Templates',exact:true}).click();
  await page.getByRole('button',{name:/^Use the Flared skirt template/}).click();
  await page.getByRole('button',{name:'Body & drape',exact:true}).click();
  const time=page.getByRole('combobox',{name:'Drape time',exact:true});
  await expect(time).toHaveValue('180');
  await page.getByRole('button',{name:'Drape on a body',exact:true}).click();
  const status=page.locator('#garment-drape-status');
  await expect(status).toContainText('3 simulated seconds',{timeout:90000});
  await page.screenshot({path:info.outputPath('standard.png')});
  await time.selectOption('720');
  await expect(status).toContainText('12 simulated seconds',{timeout:90000});
  await page.screenshot({path:info.outputPath('longer.png')});
  await page.getByText('Compare fabrics on this garment',{exact:true}).click();
  const compare=page.getByRole('combobox',{name:'Comparison drape time',exact:true});
  await expect(compare).toHaveValue('180');
  await compare.selectOption('720');
  await page.getByRole('button',{name:'Compare garment fabrics',exact:true}).click();
  await expect(page.locator('#garment-comparison-status')).toContainText('Comparison ready',{timeout:120000});
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download garment comparison',exact:true}).click();
  const receipt=JSON.parse(await readFile((await(await download).path())!,'utf8'));
  expect(receipt.settings.frames).toBe(720);
  expect(receipt.candidates.map((x:{result:{settings:{frames:number}}})=>x.result.settings.frames)).toEqual([720,720]);
  await compare.selectOption('180');
  await expect(page.getByRole('button',{name:'Download garment comparison',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('changing preview time preserves drafts and cancels the previous worker',async({page})=>{
  test.setTimeout(120000);
  await page.addInitScript(()=>{
    const Native=Worker;
    const record={longProgress:false,terminated:false};
    Object.assign(window,{settlingRun:record});
    window.Worker=class extends Native {
      private longer=false;
      constructor(...args:ConstructorParameters<typeof Worker>){
        super(...args);
        this.addEventListener('message',event=>{
          if(event.data.kind==='progress'&&event.data.frames===720) record.longProgress=this.longer=true;
        });
      }
      terminate(){if(this.longer) record.terminated=true;super.terminate();}
    };
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Templates',exact:true}).click();
  await page.getByRole('button',{name:/^Use the Blank tee template/}).click();
  await page.getByRole('button',{name:'Body & drape',exact:true}).click();
  const chest=page.getByRole('spinbutton',{name:'Body chest girth (cm)',exact:true});
  const time=page.getByRole('combobox',{name:'Drape time',exact:true});
  await chest.fill('102');
  await time.selectOption('720');
  await expect(time).toHaveValue('180');
  await expect(chest).toHaveValue('102');
  await expect(page.locator('#message')).toContainText('Apply or discard');
  await page.getByRole('button',{name:'Apply body settings',exact:true}).click();
  await time.selectOption('720');
  await page.getByRole('button',{name:'Drape on a body',exact:true}).click();
  await page.waitForFunction(()=>(window as unknown as {settlingRun:{longProgress:boolean}}).settlingRun.longProgress);
  await time.selectOption('180');
  expect(await page.evaluate(()=>(window as unknown as {settlingRun:{terminated:boolean}}).settlingRun.terminated)).toBe(true);
  await expect(page.locator('#garment-drape-status')).toContainText('3 simulated seconds',{timeout:90000});
  await expect(chest).toHaveValue('102');
});
