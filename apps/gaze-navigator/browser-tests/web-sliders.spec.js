import { test, expect } from '@playwright/test';

async function setup(page, html = '<label>Volume<input id="a" type="range" value="50"></label>') {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async html => {
    document.body.innerHTML = html;
    const { createController } = await import('/src/web/controller.js');
    window.sliderController = createController({ window });
    window.sliderEvents = [];
    for (const input of document.querySelectorAll('input')) for (const type of ['input', 'change']) {
      input.addEventListener(type, () => window.sliderEvents.push([input.id, type, input.value]));
    }
    window.sliderContext = () => ({ elements: [...document.querySelectorAll('input, [role=slider]')].map((element, i) => ({ id: i + 1, element, name: element.labels?.[0]?.textContent ?? element.getAttribute('aria-label'), role: 'slider', distance: 20 })) });
    window.commandSlider = text => window.sliderController.handle(text, window.sliderContext());
  }, html);
}
const command = (page, text) => page.evaluate(text => window.commandSlider(text), text);

test('native exact values dispatch both events and support independent guarded Undo', async ({ page }) => {
  await setup(page);
  expect((await command(page, 'set Volume slider to 70')).performed).toBe('range');
  await expect(page.locator('#a')).toHaveValue('70');
  expect(await page.evaluate(() => window.sliderEvents)).toEqual([['a', 'input', '70'], ['a', 'change', '70']]);
  await command(page, 'set Volume slider to 70'); // no-op must not hide the prior edit
  await page.locator('#a').evaluate(e => { e.disabled = true; });
  expect((await command(page, 'undo slider')).tone).toBe('error');
  await page.locator('#a').evaluate(e => { e.disabled = false; });
  await command(page, 'undo slider');await expect(page.locator('#a')).toHaveValue('50');
  expect((await command(page, 'undo slider')).message).toContain('Nothing to undo');
});

test('min max step and signed decimals refuse silent native clamping or rounding', async ({ page }) => {
  await setup(page, '<label>Balance<input id="a" type="range" min="-1" max="1" step="0.25" value="0"></label>');
  for (const value of ['-1.1', '1.1', '0.1']) expect((await command(page, `set Balance slider to ${value}`)).tone).toBe('error');
  await expect(page.locator('#a')).toHaveValue('0');expect(await page.evaluate(() => window.sliderEvents)).toEqual([]);
  await command(page, 'set Balance slider to -0.25');await expect(page.locator('#a')).toHaveValue('-0.25');
  await page.locator('#a').evaluate(e => { e.min = '0'; }); // old value no longer representable for Undo? prior0 still legal
  await command(page, 'undo slider');await expect(page.locator('#a')).toHaveValue('0');
  await page.locator('#a').evaluate(e => { e.step = 'any'; });
  await command(page, 'set Balance slider to 0.123');await expect(page.locator('#a')).toHaveValue('0.123');
});

test('ambiguous sliders wait for a deliberate choice and cancellation retires that intent', async ({ page }) => {
  await setup(page, '<label>Volume<input id="a" type="range" value="50"></label><label>Volume<input id="b" type="range" value="20"></label>');
  expect((await command(page, 'set Volume slider to 70')).pending.kind).toBe('clarify');
  await command(page, 'cancel');await command(page, 'two');await expect(page.locator('#b')).toHaveValue('20');
  await command(page, 'set Volume slider to 70');await command(page, 'two');
  await expect(page.locator('#a')).toHaveValue('50');await expect(page.locator('#b')).toHaveValue('70');
  await command(page, 'pause');await command(page, 'set Volume slider to 60');await expect(page.locator('#b')).toHaveValue('70');
  await command(page, 'resume');await command(page, 'undo Volume slider');await command(page, 'two');await expect(page.locator('#b')).toHaveValue('20');
});

test('captured custom detached changed-type and ancestor-locked targets never receive writes', async ({ page }) => {
  for (const mutate of ['e.remove()', 'e.type="text"', 'e.parentElement.inert=true', 'e.parentElement.setAttribute("aria-disabled","true")', 'e.parentElement.setAttribute("aria-readonly","true")', 'e.readOnly=true']) {
    await setup(page);
    const result = await page.evaluate(mutate => {
      const context = window.sliderContext();const e = document.querySelector('#a');Function('e', mutate)(e);
      return window.sliderController.handle('set Volume slider to 70', context);
    }, mutate);
    expect(result.tone, mutate).toBe('error');expect(await page.evaluate(() => window.sliderEvents)).toEqual([]);
  }
  await setup(page, '<div role="slider" aria-label="Volume" tabindex="0" aria-valuenow="50"></div>');
  expect((await command(page, 'set Volume slider to 70')).tone).toBe('error');
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '50');
});

test('focus handlers that lock replace redirect or change constraints refuse before input events', async ({ page }) => {
  for (const effect of ['e.disabled=true', 'e.max="60"', 'e.value="30"', 'e.replaceWith(e.cloneNode())', 'document.querySelector("#other").focus()']) {
    await setup(page, '<label>Volume<input id="a" type="range" value="50"></label><button id="other">Other</button>');
    await page.locator('#a').evaluate((e, effect) => e.addEventListener('focus', () => Function('e', effect)(e), { once: true }), effect);
    expect((await command(page, 'set Volume slider to 70')).tone, effect).toBe('error');
    expect(await page.evaluate(() => window.sliderEvents), effect).toEqual([]);
  }
});

test('shadow and same-origin frame ancestor locks refuse captured sliders', async ({ page }) => {
  await setup(page, '<div id="host"></div><iframe id="frame"></iframe>');
  expect(await page.evaluate(async () => {
    const host = document.querySelector('#host');const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<input type="range" value="50" aria-label="Volume">';const shadow = root.querySelector('input');
    const frame = document.querySelector('#frame');frame.contentDocument.body.innerHTML = '<input type="range" value="50">';const child = frame.contentDocument.querySelector('input');
    const outputs=[];
    for (const [element,ancestor] of [[shadow,host],[child,frame]]) {
      const context={elements:[{id:1,element,name:'Volume',role:'slider',distance:0}]};
      window.sliderController.handle('set Volume slider to 60',context);
      if (element.value !== '60') throw new Error('Native nested slider was not changed');
      window.sliderController.handle('undo slider',context);
      if (element.value !== '50') throw new Error('Native nested slider Undo failed');
      ancestor.setAttribute('aria-readonly','true');outputs.push(window.sliderController.handle('set Volume slider to 70',context).tone,element.value);
    }
    return outputs;
  })).toEqual(['error','50','error','50']);
});

test('shared navigator overlay discovers a real page slider and runs the typed command flow', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(() => {
    const label = document.createElement('label');label.style.cssText = 'position:fixed;top:4px;left:4px;z-index:10;background:white;padding:12px;';
    label.textContent = 'Playback volume';const slider = document.createElement('input');slider.type = 'range';slider.value = '50';slider.id = 'real-slider';label.append(slider);document.body.append(label);
  });
  const slider = page.locator('#real-slider');const box = await slider.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const panel = page.locator('#gaze-web-navigator section');
  await expect(panel.locator('.context')).toContainText('Playback volume');
  await panel.getByLabel('Typed instruction').fill('set Playback volume slider to 35');
  await panel.getByRole('button', { name: 'Do it', exact: true }).click();
  await expect(slider).toHaveValue('35');await expect(panel.locator('.status')).toContainText('Slider set to 35');
  await panel.getByLabel('Typed instruction').fill('undo Playback volume slider');
  await panel.getByRole('button', { name: 'Do it', exact: true }).click();await expect(slider).toHaveValue('50');
});

test('Undo retains history when changed limits make the previous value invalid', async ({ page }) => {
  await setup(page);await command(page, 'set slider to 70');
  await page.locator('#a').evaluate(e => { e.min = '60'; });
  expect((await command(page, 'undo slider')).tone).toBe('error');await expect(page.locator('#a')).toHaveValue('70');
  await page.locator('#a').evaluate(e => { e.min = '0'; });
  await command(page, 'undo slider');await expect(page.locator('#a')).toHaveValue('50');
});


test('a website overriding the input event reports its observed value and retains recovery', async ({ page }) => {
  await setup(page);
  await page.locator('#a').evaluate(e => e.addEventListener('input', () => { e.value = '80'; }, { once: true }));
  const result = await command(page, 'set slider to 70');
  expect(result.tone).toBe('error');expect(result.message).toContain('website changed the slider to 80');
  await expect(page.locator('#a')).toHaveValue('80');
  await command(page, 'undo slider');await expect(page.locator('#a')).toHaveValue('50');
});

test('shadow component hosts observe the same input propagation as a native slider gesture', async ({ page }) => {
  await setup(page, '<div id="host"></div>');
  await page.evaluate(() => {
    const host = document.querySelector('#host');host.attachShadow({ mode: 'open' }).innerHTML = '<input type="range" value="50">';
    const slider = host.shadowRoot.querySelector('input');window.propagation=[];
    for (const [scope,name] of [[host.shadowRoot,'root'],[document,'document']]) for (const type of ['input','change']) {
      scope.addEventListener(type, event => window.propagation.push([name,type,event.composed]));
    }
    window.sliderContext = () => ({ elements:[{id:1,element:slider,name:'Volume',role:'slider',distance:0}] });
  });
  await page.locator('#host input').press('ArrowRight');
  const native = await page.evaluate(() => { const result=window.propagation;window.propagation=[];document.querySelector('#host').shadowRoot.querySelector('input').value='50';return result; });
  await command(page, 'set slider to 51');
  expect(await page.evaluate(() => window.propagation)).toEqual(native);
});

test('a site replacing or removing a slider during input cannot produce false success or a late change', async ({ page }) => {
  for (const event of ['input','change']) {
    await setup(page);
    await page.locator('#a').evaluate((element,event) => element.addEventListener(event, () => { const replacement=element.cloneNode();replacement.value='50';element.replaceWith(replacement); }, { once:true }),event);
    const result = await command(page,'set slider to 70');
    expect(result.tone).toBe('error');expect(result.performed).toBeNull();
    await expect(page.locator('#a')).toHaveValue('50');
    if(event==='input') expect(await page.evaluate(() => window.sliderEvents)).toEqual([['a','input','70']]);
    expect((await command(page,'undo slider')).message).toContain('Nothing to undo');
  }
});
