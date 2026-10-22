import { test, expect } from '@playwright/test';
const html = '<label>Genres<select id="a" multiple><option selected>Rock</option><option>Jazz</option><option selected>Classical</option></select></label><button id="other">Other</button>';
async function setup(page, body = html) {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async body => {
    document.body.innerHTML = body;
    const { createController } = await import('/src/web/controller.js');
    const { captureContext } = await import('/src/web/page-context.js');
    window.c = createController({ window }); window.events = [];
    for (const e of document.querySelectorAll('select')) for (const type of ['input', 'change']) e.addEventListener(type, event => window.events.push([e.id, type, [...e.options].map(o => o.selected), event.composed]));
    window.ctx = () => captureContext(document, { x: 100, y: 60, radius: 1000 });
    window.run = async (text, context = window.ctx()) => { const r = window.c.handle(text, context); return r.followUp ? await r.followUp : r; };
  }, body);
}
const run = (page, text = 'add option Jazz to Genres') => page.evaluate(text => window.run(text), text);
const state = page => page.locator('#a').evaluate(e => [...e.options].map(o => o.selected));
test('explicit native add/remove preserves other choices and no-op emits no events', async ({ page }) => {
  await setup(page); expect(await run(page)).toMatchObject({ performed: 'select-option', tone: 'success' }); expect(await state(page)).toEqual([true, true, true]);
  expect(await page.evaluate(() => window.events)).toEqual([['a', 'input', [true, true, true], true], ['a', 'change', [true, true, true], false]]);
  await run(page); expect((await page.evaluate(() => window.events)).length).toBe(2);
  expect(await run(page, 'remove option Rock from Genres')).toMatchObject({ tone: 'success' }); expect(await state(page)).toEqual([false, true, true]);
  await run(page, 'remove option Rock from Genres'); expect((await page.evaluate(() => window.events)).length).toBe(4);
  expect(await run(page, 'choose Jazz from Genres')).toMatchObject({ tone: 'error' }); expect(await state(page)).toEqual([false, true, true]);
});
test('stale captured option or selection graph refuses before events', async ({ page }) => {
  for (const change of ['e.options[0].selected=false', 'e.options[1].replaceWith(e.options[1].cloneNode(true))', 'e.options[1].label="Different"', 'e.prepend(e.options[2])', 'e.multiple=false', 'e.disabled=true', 'e.parentElement.inert=true', 'e.parentElement.setAttribute("aria-readonly","true")', 'e.options[1].disabled=true']) {
    await setup(page); const result = await page.evaluate(async change => { const ctx = window.ctx(), e = document.querySelector('#a'); Function('e', change)(e); return window.run('add option Jazz to Genres', ctx); }, change);
    expect(result.tone, change).toBe('error'); expect(await page.evaluate(() => window.events), change).toEqual([]);
  }
});
test('focus changes and site handlers cannot silently change other selected options', async ({ page }) => {
  for (const [event, change] of [['focus', 'e.options[0].selected=false'], ['focus', 'document.querySelector("#other").focus()'], ['input', 'e.options[0].selected=false'], ['change', 'e.options[1].selected=false'], ['change', 'queueMicrotask(()=>e.options[2].selected=false)'], ['change', 'queueMicrotask(()=>e.disabled=true)']]) {
    await setup(page); await page.locator('#a').evaluate((e, [event, change]) => e.addEventListener(event, () => Function('e', change)(e), { once: true }), [event, change]);
    expect((await run(page)).tone, `${event}: ${change}`).toBe('error');
  }
});
test('duplicate list and option clarification keeps captured state and cancellation', async ({ page }) => {
  await setup(page, html + html.replace('id="a"', 'id="b"'));
  expect((await run(page)).pending.kind).toBe('clarify'); await run(page, 'cancel'); await run(page, 'two'); expect(await state(page)).toEqual([true, false, true]);
  await run(page); await page.locator('#b').evaluate(e => { e.options[0].selected = false; });
  expect((await run(page, 'two')).tone).toBe('error'); expect(await page.evaluate(() => window.events)).toEqual([]);
  expect((await run(page)).pending.kind).toBe('clarify'); expect((await run(page, 'two')).tone).toBe('success');
  expect(await page.locator('#b').evaluate(e => [...e.options].map(o => o.selected))).toEqual([false, true, true]);
});
test('consequential multi-select additions and removals require confirmation', async ({ page }) => {
  await setup(page, '<label>Actions<select id="a" multiple><option>Keep</option><option>Delete account</option></select></label>');
  expect((await run(page, 'add option Delete account to Actions')).pending.kind).toBe('confirm'); expect(await page.evaluate(() => window.events)).toEqual([]);
  expect((await run(page, 'confirm')).tone).toBe('success'); expect(await state(page)).toEqual([false, true]);
  expect((await run(page, 'remove option Delete account from Actions')).pending.kind).toBe('confirm'); await run(page, 'cancel'); expect(await state(page)).toEqual([false, true]);
});

test('ordinary keyboard instruction and focus-preserving shortcut edit a real visible list', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async html => {
    window.gazeNavigator.stop(); document.body.innerHTML = `<main style="padding:30px;width:240px">${html}</main>`;
    const { startWebNavigator } = await import('/src/web/overlay.js');
    window.gazeNavigator = startWebNavigator({ window });
  }, html);
  const select = page.locator('#a'), box = await select.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const panel = page.locator('#gaze-web-navigator section');
  await expect(panel.locator('.context')).toContainText('Genres');
  await panel.getByLabel('Typed instruction').fill('add option Jazz to Genres');
  await panel.getByLabel('Typed instruction').press('Enter');
  await expect(panel.locator('.status')).toContainText('Jazz added to the selection');
  expect(await state(page)).toEqual([true, true, true]);
  await select.focus(); await page.keyboard.press('Alt+Shift+G');
  await page.keyboard.type('remove option Rock from Genres'); await page.keyboard.press('Enter');
  await expect(panel.locator('.status')).toContainText('Rock removed from the selection');
  expect(await state(page)).toEqual([false, true, true]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('shadow lists and same-origin frames retain lock and document ownership', async ({ page }) => {
  await setup(page, '<div id="host"></div><iframe id="frame"></iframe>');
  expect(await page.evaluate(async html => {
    const { captureSelectSnapshot } = await import('/src/web/page-context.js');
    const host = document.querySelector('#host'), root = host.attachShadow({ mode: 'open' }), frame = document.querySelector('#frame');
    root.innerHTML = html; frame.contentDocument.body.innerHTML = html;
    const results = [];
    for (const [e, ancestor] of [[root.querySelector('select'), host], [frame.contentDocument.querySelector('select'), frame]]) {
      const context = () => ({ elements: [{ id: 1, element: e, role: 'combobox', name: 'Genres', options: ['Rock', 'Jazz', 'Classical'], selectSnapshot: captureSelectSnapshot(e) }] });
      results.push((await window.run('add option Jazz', context())).tone, [...e.options].map(o => o.selected));
      const captured = context(); ancestor.inert = true;
      results.push((await window.run('remove option Rock', captured)).tone, [...e.options].map(o => o.selected));
    }
    return results;
  }, html)).toEqual(['success', [true, true, true], 'error', [true, true, true], 'success', [true, true, true], 'error', [true, true, true]]);
});

test('retired frame and replaced optgroup cannot acknowledge old multi-select choices', async ({ page }) => {
  await setup(page, '<iframe id="frame"></iframe>');
  expect(await page.evaluate(async html => {
    const { captureSelectSnapshot } = await import('/src/web/page-context.js');
    const frame = document.querySelector('#frame'); frame.contentDocument.body.innerHTML = html;
    const e = frame.contentDocument.querySelector('select'), captured = { elements: [{ id: 1, element: e, role: 'combobox', name: 'Genres', options: ['Rock', 'Jazz', 'Classical'], selectSnapshot: captureSelectSnapshot(e) }] };
    e.addEventListener('change', () => queueMicrotask(() => frame.remove()), { once: true });
    return (await window.run('add option Jazz', captured)).tone;
  }, html)).toBe('error');
  await setup(page, '<label>Genres<select id="a" multiple><option selected>Rock</option><optgroup label="Music"><option>Jazz</option></optgroup></select></label>');
  await page.locator('#a').evaluate(e => e.addEventListener('focus', () => { const g = e.querySelector('optgroup'); g.replaceWith(g.cloneNode(true)); }, { once: true }));
  expect((await run(page)).tone).toBe('error'); expect(await page.evaluate(() => window.events)).toEqual([]);
});
