import { test, expect } from '@playwright/test';
async function setup(page, html = '<label>Standard<input id="a" name="delivery" type="radio" checked></label><label>Express<input id="b" name="delivery" type="radio"></label>') {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async html => {
    document.body.innerHTML = html;
    const { createController } = await import('/src/web/controller.js');
    const { captureContext } = await import('/src/web/page-context.js');
    window.radioController = createController({ window }); window.radioEvents = [];
    document.addEventListener('click', e => window.radioEvents.push(e.target.id));
    window.radioContext = () => captureContext(document, { x: 100, y: 20, radius: 1000 });
    window.radioCommand = async text => { const r = window.radioController.handle(text, window.radioContext()); return await (r.followUp ?? r); };
  }, html);
}
const command = (page, text) => page.evaluate(text => window.radioCommand(text), text);

test('native radio selection replaces the group choice and repeated selection emits no extra click', async ({ page }) => {
  await setup(page);
  expect((await command(page, 'select Express radio button')).performed).toBe('select-radio');
  await expect(page.locator('#a')).not.toBeChecked(); await expect(page.locator('#b')).toBeChecked();
  expect((await command(page, 'choose Express radio button')).tone).toBe('success');
  expect(await page.evaluate(() => window.radioEvents)).toEqual(['b']);
  await command(page, 'select Standard radio button'); await expect(page.locator('#a')).toBeChecked();
});

test('ARIA radio selection uses site microtasks and repeated selection emits no extra click', async ({ page }) => {
  await setup(page, '<button id="a" type="button" role="radio" aria-checked="false">Express</button>');
  await page.locator('#a').evaluate(e => e.addEventListener('click', () => queueMicrotask(() => e.setAttribute('aria-checked', 'true'))));
  expect((await command(page, 'select Express radio button')).tone).toBe('success');
  await expect(page.locator('#a')).toHaveAttribute('aria-checked', 'true');
  expect((await command(page, 'select Express radio button')).tone).toBe('success');
  expect(await page.evaluate(() => window.radioEvents)).toEqual(['a']);
});

test('cancelled native clicks and nested microtask reversions never report selected', async ({ page }) => {
  for (const effect of ['event.preventDefault()', 'queueMicrotask(()=>queueMicrotask(()=>e.checked=false))', 'e.disabled=true', 'e.replaceWith(e.cloneNode())']) {
    await setup(page); await page.locator('#b').evaluate((e, effect) => e.addEventListener('click', event => Function('e', 'event', effect)(e, event)), effect);
    expect((await command(page, 'select Express radio button')).tone, effect).toBe('error');
    expect(await page.evaluate(() => window.radioEvents), effect).toEqual(['b']);
  }
});

test('unavailable controls and focus-time changes refuse before activation', async ({ page }) => {
  for (const effect of ['e.disabled=true', 'e.readOnly=true', 'e.parentElement.inert=true', 'e.parentElement.setAttribute("aria-readonly","true")', 'e.type="text"', 'e.name="other"', 'e.value="other"', 'e.setAttribute("aria-label","Other")', 'e.replaceWith(e.cloneNode())', 'document.querySelector("#other").focus()']) {
    await setup(page, '<label>Express<input id="b" name="delivery" type="radio"></label><button id="other">Other</button>');
    await page.locator('#b').evaluate((e, effect) => e.addEventListener('focus', () => Function('e', effect)(e), { once: true }), effect);
    expect((await command(page, 'select Express radio button')).tone, effect).toBe('error');
    expect(await page.evaluate(() => window.radioEvents), effect).toEqual([]);
  }
});

test('missing mixed invalid or unsafe ARIA radios refuse without clicking', async ({ page }) => {
  for (const html of ['<button type="button" role="radio">Express</button>', '<button type="button" role="radio" aria-checked="mixed">Express</button>', '<button type="button" role="radio" aria-checked="yes">Express</button>', '<input type="checkbox" role="radio" aria-label="Express" aria-checked="false">', '<a href="javascript:window.bad=1" role="radio" aria-checked="false">Express</a>', '<form><button type="submit" role="radio" aria-checked="false">Express</button></form>']) {
    await setup(page, html); let result = await command(page, 'select Express radio button');
    if (result.pending?.kind === 'confirm') result = await command(page, 'confirm');
    expect(result.tone, html).toBe('error');
    expect(await page.evaluate(() => window.radioEvents), html).toEqual([]);
  }
});

test('ARIA refusals role changes and reverted states never claim success', async ({ page }) => {
  for (const effect of ['', 'e.setAttribute("aria-checked","true");queueMicrotask(()=>queueMicrotask(()=>e.setAttribute("aria-checked","false")))', 'e.setAttribute("aria-checked","true");e.setAttribute("role","checkbox")', 'e.setAttribute("aria-checked","true");e.remove()']) {
    await setup(page, '<button id="a" type="button" role="radio" aria-checked="false">Express</button>');
    await page.locator('#a').evaluate((e, effect) => e.addEventListener('click', () => Function('e', effect)(e)), effect);
    expect((await command(page, 'select Express radio button')).tone, effect).toBe('error');
    expect(await page.evaluate(() => window.radioEvents), effect).toEqual(['a']);
  }
});

test('ambiguity confirmation cancel and changed identities preserve intended selection', async ({ page }) => {
  await setup(page, '<label>Delete account<input id="a" type="radio" name="choice"></label><label>Delete account<input id="b" type="radio" name="choice"></label>');
  let result = await command(page, 'select Delete account radio button'); expect(result.pending.kind).toBe('clarify');
  result = await command(page, String(result.pending.candidates[1].number)); expect(result.pending.kind).toBe('confirm');
  await command(page, 'cancel'); await command(page, 'confirm'); expect(await page.evaluate(() => window.radioEvents)).toEqual([]);
  result = await command(page, 'select Delete account radio button'); await command(page, String(result.pending.candidates[1].number));
  await page.locator('#b').evaluate(e => e.name = 'another-group');
  expect((await command(page, 'confirm')).tone).toBe('error'); expect(await page.evaluate(() => window.radioEvents)).toEqual([]);
  result = await command(page, 'select Delete account radio button'); await command(page, String(result.pending.candidates[1].number));
  expect((await command(page, 'confirm')).tone).toBe('success'); await expect(page.locator('#b')).toBeChecked();
});

test('same-origin frames and open shadow roots retain radio selection and ancestor locks', async ({ page }) => {
  await setup(page, '<div id="host"></div><iframe id="frame"></iframe>');
  expect(await page.evaluate(async () => {
    const host = document.querySelector('#host'), root = host.attachShadow({ mode: 'open' }), frame = document.querySelector('#frame');
    root.innerHTML = '<label>Express<input type="radio"></label>'; frame.contentDocument.body.innerHTML = '<label>Express<input type="radio"></label>';
    const { captureRadioSnapshot } = await import('/src/web/page-context.js'); const results = [];
    for (const [element, ancestor] of [[root.querySelector('input'), host], [frame.contentDocument.querySelector('input'), frame]]) {
      const context = { elements: [{ id: 1, element, role: 'radio', name: 'Express', radioSnapshot: captureRadioSnapshot(element), distance: 0 }] };
      let r = window.radioController.handle('select Express radio button', context); r = await (r.followUp ?? r); results.push(r.tone, element.checked);
      element.checked = false; ancestor.setAttribute('aria-disabled', 'true');
      r = window.radioController.handle('select Express radio button', context); r = await (r.followUp ?? r); results.push(r.tone, element.checked);
    } return results;
  })).toEqual(['success', true, 'error', false, 'success', true, 'error', false]);
});

test('cancel and newer commands retire pending radio verification feedback', async ({ page }) => {
  await setup(page);
  expect(await page.evaluate(async () => {
    const r = window.radioController.handle('select Express radio button', window.radioContext());
    window.radioController.cancel(); return (await r.followUp) === null;
  })).toBe(true);
});

test('hidden selected targets and reassigned ARIA groups refuse captured commands', async ({ page }) => {
  for (const effect of ['e.hidden=true', 'e.parentElement.style.visibility="hidden"', 'document.querySelector("#other-group").append(e)']) {
    await setup(page, '<div role="radiogroup"><button id="a" type="button" role="radio" aria-label="Express" aria-checked="true">Express</button></div><div id="other-group" role="radiogroup"></div>');
    const result = await page.evaluate(async effect => {
      const context = window.radioContext(), e = document.querySelector('#a'); Function('e', effect)(e);
      const r = window.radioController.handle('select Express radio button', context); return await (r.followUp ?? r);
    }, effect);
    expect(result.tone, effect).toBe('error'); expect(await page.evaluate(() => window.radioEvents)).toEqual([]);
  }
});

test('a custom radio moved to another radiogroup cannot satisfy an old request', async ({ page }) => {
  await setup(page, '<div role="radiogroup"><button id="a" type="button" role="radio" aria-checked="false">Express</button></div><div id="other-group" role="radiogroup"></div>');
  expect(await page.evaluate(async () => {
    const context = window.radioContext(), e = document.querySelector('#a');
    e.addEventListener('click', () => e.setAttribute('aria-checked', 'true')); document.querySelector('#other-group').append(e);
    const r = window.radioController.handle('select Express radio button', context); return (await (r.followUp ?? r)).tone;
  })).toBe('error');
  expect(await page.evaluate(() => window.radioEvents)).toEqual([]);
});

test('custom div radios retain form ownership and visibility through website microtasks', async ({ page }) => {
  await setup(page, '<form id="f1"><div id="a" tabindex="0" role="radio" aria-label="Express" aria-checked="false">Express</div></form><form id="f2"></form>');
  expect(await page.evaluate(async () => {
    const context = window.radioContext(), e = document.querySelector('#a'); document.querySelector('#f2').append(e);
    e.addEventListener('click', () => e.setAttribute('aria-checked', 'true'));
    const r = window.radioController.handle('select Express radio button', context); return (await (r.followUp ?? r)).tone;
  })).toBe('error'); expect(await page.evaluate(() => window.radioEvents)).toEqual([]);
  await setup(page, '<button id="a" type="button" role="radio" aria-label="Express" aria-checked="false">Express</button>');
  await page.locator('#a').evaluate(e => e.addEventListener('click', () => { e.setAttribute('aria-checked', 'true'); queueMicrotask(() => { e.hidden = true; }); }));
  expect((await command(page, 'select Express radio button')).tone).toBe('error');
  expect(await page.evaluate(() => window.radioEvents)).toEqual(['a']);
});
