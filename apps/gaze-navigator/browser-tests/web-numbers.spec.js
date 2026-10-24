import { test, expect } from '@playwright/test';
async function setup(page, html = '<label>Quantity<input id="a" type="number" min="0" max="10" value="2"></label>') {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async html => {
    document.body.innerHTML = html;
    const { createController } = await import('/src/web/controller.js');
    const { captureContext } = await import('/src/web/page-context.js');
    window.nc = createController({ window }); window.events = [];
    for (const e of document.querySelectorAll('input')) for (const type of ['input', 'change']) e.addEventListener(type, () => events.push([e.id, type, e.value]));
    window.nContext = () => captureContext(document, { x: 100, y: 20, radius: 1500 });
    window.nCommand = async text => { const r = nc.handle(text, nContext()); return r.followUp ? await r.followUp : r; };
  }, html);
}
const command = (page, text) => page.evaluate(text => nCommand(text), text);
test('exact numeric values emit native events, no-op retains Undo, and empty required fields restore', async ({ page }) => {
  await setup(page);
  expect((await command(page, 'set Quantity number field to 4')).performed).toBe('number');
  await expect(page.locator('#a')).toHaveValue('4');
  expect(await page.evaluate(() => events)).toEqual([['a','input','4'],['a','change','4']]);
  await command(page, 'set number field to 4');await command(page, 'undo number field');
  await expect(page.locator('#a')).toHaveValue('2');
  expect((await command(page, 'undo number field')).message).toContain('Nothing to undo');
  await command(page, 'set number field to 4');await command(page, 'set number field to 6');
  await page.locator('#a').evaluate(e => e.value = '4');
  await command(page, 'undo number field');await command(page, 'undo number field');
  await expect(page.locator('#a')).toHaveValue('2');
  await setup(page, '<label>Quantity<input id="a" type="number" required></label>');
  await command(page, 'set number field to 3');await command(page, 'undo number field');
  await expect(page.locator('#a')).toHaveValue('');
});
test('native min max step default value-base and any govern set and current-limit Undo', async ({ page }) => {
  await setup(page, '<label>Quantity<input id="a" type="number" min="-1" max="1" step="0.25" value="0"></label>');
  for (const value of ['-1.1','1.1','0.1','three','3%']) expect((await command(page, `set number field to ${value}`)).tone, value).toBe('error');
  expect(await page.evaluate(() => events)).toEqual([]);
  await command(page, 'set number field to -0.25');await page.locator('#a').evaluate(e => e.max = '-0.1');
  expect((await command(page, 'undo number field')).tone).toBe('error');
  await page.locator('#a').evaluate(e => e.max = '1');await command(page, 'undo number field');await expect(page.locator('#a')).toHaveValue('0');
  await setup(page, '<label>Quantity<input id="a" type="number" value="0.5"></label>');
  expect((await command(page, 'set number field to 1')).tone).toBe('error');
  await command(page, 'set number field to 1.5');await expect(page.locator('#a')).toHaveValue('1.5');
  await page.locator('#a').evaluate(e => e.step = 'any');await command(page, 'set number field to -0.123');await expect(page.locator('#a')).toHaveValue('-0.123');
});
test('captured changed identity constraints visibility locks and focus handlers refuse before events', async ({ page }) => {
  for (const effect of ['e.remove()', 'e.type="text"', 'e.min="1"', 'e.value="3"', 'e.setAttribute("aria-label","Other")', 'e.hidden=true', 'e.parentElement.inert=true', 'e.parentElement.setAttribute("aria-readonly","true")', 'e.readOnly=true']) {
    await setup(page);
    const r = await page.evaluate(effect => { const c=nContext(), e=document.querySelector('#a');Function('e',effect)(e);return nc.handle('set Quantity number field to 4',c); },effect);
    expect(r.tone,effect).toBe('error');expect(await page.evaluate(() => events),effect).toEqual([]);
  }
  for (const effect of ['e.disabled=true','e.step="3"','e.value="3"','e.replaceWith(e.cloneNode())','document.querySelector("button").focus()']) {
    await setup(page, '<label>Quantity<input id="a" type="number" value="2"></label><button>Other</button>');
    await page.locator('#a').evaluate((e,effect) => e.addEventListener('focus',()=>Function('e',effect)(e),{once:true}),effect);
    expect((await command(page,'set number field to 4')).tone,effect).toBe('error');expect(await page.evaluate(() => events),effect).toEqual([]);
  }
});
test('ambiguous and consequential numeric intent preserves confirmation cancellation and independent histories', async ({ page }) => {
  await setup(page,'<label>Quantity<input id="a" type="number" value="2"></label><label>Quantity<input id="b" type="number" value="5"></label>');
  expect((await command(page,'set Quantity number field to 7')).pending.kind).toBe('clarify');
  await command(page,'cancel');await command(page,'two');await expect(page.locator('#b')).toHaveValue('5');
  await command(page,'set Quantity number field to 7');await command(page,'two');await expect(page.locator('#b')).toHaveValue('7');
  await command(page,'undo Quantity number field');await command(page,'two');await expect(page.locator('#b')).toHaveValue('5');await expect(page.locator('#a')).toHaveValue('2');
  await setup(page,'<label>Transfer<input id="a" type="number" value="2"></label>');
  expect((await command(page,'set Transfer number field to 4')).pending.kind).toBe('confirm');await expect(page.locator('#a')).toHaveValue('2');
  await command(page,'cancel');await command(page,'confirm');await expect(page.locator('#a')).toHaveValue('2');
  await command(page,'set Transfer number field to 4');await command(page,'confirm');await expect(page.locator('#a')).toHaveValue('4');
});
test('nested website overrides are observed and replacement nodes never inherit numeric history', async ({ page }) => {
  await setup(page);
  await page.locator('#a').evaluate(e => e.addEventListener('input',()=>queueMicrotask(()=>queueMicrotask(()=>e.value='8')),{once:true}));
  const r=await command(page,'set number field to 4');expect(r.tone).toBe('error');expect(r.message).toContain('8');
  await command(page,'undo number field');await expect(page.locator('#a')).toHaveValue('2');
  await page.locator('#a').evaluate(e => e.addEventListener('input',()=>e.replaceWith(e.cloneNode()),{once:true}));
  expect((await command(page,'set number field to 4')).tone).toBe('error');
  expect((await command(page,'undo number field')).message).toContain('Nothing to undo');
});

test('literal decimal precision and delayed site acceptance retain exact value and Undo', async ({ page }) => {
  await setup(page, '<label>Quantity<input id="a" type="number" step="any" value="2"></label>');
  for (const value of ['9007199254740993','0.10000000000000001']) {
    await command(page, `set number field to ${value}`);await expect(page.locator('#a')).toHaveValue(value);
    await command(page, 'undo number field');await expect(page.locator('#a')).toHaveValue('2');
  }
  await page.locator('#a').evaluate(e => e.addEventListener('input',()=>{e.value='2';queueMicrotask(()=>e.value='4');},{once:true}));
  expect((await command(page,'set number field to 4')).performed).toBe('number');
  await command(page,'undo number field');await expect(page.locator('#a')).toHaveValue('2');
});

test('shadow and frame numeric controls retain native event propagation and ancestor locks', async ({ page }) => {
  await setup(page,'<div id="host"></div><iframe id="frame"></iframe>');
  expect(await page.evaluate(async () => {
    const { captureNumberSnapshot } = await import('/src/web/page-context.js');
    const host=document.querySelector('#host');host.attachShadow({mode:'open'}).innerHTML='<input type="number" value="2">';
    const frame=document.querySelector('#frame');frame.contentDocument.body.innerHTML='<input type="number" value="2">';
    const result=[];
    for (const [element,ancestor] of [[host.shadowRoot.querySelector('input'),host],[frame.contentDocument.querySelector('input'),frame]]) {
      window.nContext=()=>({elements:[{id:1,element,name:'Quantity',role:'textbox',nativeNumber:true,numberSnapshot:captureNumberSnapshot(element),distance:0}]});
      result.push((await nCommand('set number field to 4')).performed, element.value);
      await nCommand('undo number field');result.push(element.value);
      const c=nContext();ancestor.setAttribute('aria-readonly','true');result.push(nc.handle('set number field to 5',c).tone,element.value);
    }
    return result;
  })).toEqual(['number','4','2','error','2','number','4','2','error','2']);
});

test('a newer numeric write consumes an earlier applied Undo without duplicate history', async ({ page }) => {
  await setup(page);await command(page,'set number field to 4');await command(page,'set number field to 6');
  await page.evaluate(async () => {
    const first=nc.handle('undo number field',nContext());
    const second=nc.handle('set number field to 8',nContext());
    await Promise.all([first.followUp,second.followUp]);
  });
  await command(page,'undo number field');await expect(page.locator('#a')).toHaveValue('4');
  await command(page,'undo number field');await expect(page.locator('#a')).toHaveValue('2');
  expect((await command(page,'undo number field')).message).toContain('Nothing to undo');
});
