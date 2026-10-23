import { test, expect } from '@playwright/test';
const markup = '<div id="tabs" role="tablist" aria-label="Product"><button id="a" type="button" role="tab" aria-selected="true" aria-controls="panel-a">Overview</button><button id="b" type="button" role="tab" aria-selected="false" aria-controls="panel-b">Details</button></div><button id="other">Other</button><div id="elsewhere" role="tablist" aria-label="Other group"></div>';
async function setup(page, html = markup) {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async html => {
    document.body.innerHTML = html;
    const { createController } = await import('/src/web/controller.js'), { captureContext } = await import('/src/web/page-context.js');
    window.tabController = createController({ window }); window.tabEvents = [];
    document.addEventListener('click', event => window.tabEvents.push(event.target.id));
    window.tabContext = () => captureContext(document, { x: 100, y: 20, radius: 1000 });
    window.tabCommand = async text => { const r = window.tabController.handle(text, window.tabContext()); return await (r.followUp ?? r); };
    window.selectSiteTab = e => { for (const sibling of e.parentElement.querySelectorAll('[role=tab]')) sibling.setAttribute('aria-selected', String(sibling === e)); };
    document.querySelector('#b')?.addEventListener('click', event => queueMicrotask(() => queueMicrotask(() => window.selectSiteTab(event.target))));
  }, html);
}
const command = (page, text) => page.evaluate(text => window.tabCommand(text), text);
test('manual website tab selection retains site state and repeated request is a no-op', async ({ page }) => {
  await setup(page); expect((await command(page, 'select Details tab')).performed).toBe('select-tab');
  await expect(page.locator('#b')).toHaveAttribute('aria-selected', 'true'); await expect(page.locator('#a')).toHaveAttribute('aria-selected', 'false');
  expect((await command(page, 'choose tab Details')).tone).toBe('success'); expect(await page.evaluate(() => window.tabEvents)).toEqual(['b']);
});

test('focus-driven synchronous and nested-microtask selection needs no click', async ({ page }) => {
  for (const asynchronous of [false, true]) {
    await setup(page); await page.locator('#b').evaluate((e, asynchronous) => e.addEventListener('focus', () => {
      if (asynchronous) queueMicrotask(() => queueMicrotask(() => window.selectSiteTab(e))); else window.selectSiteTab(e);
    }), asynchronous);
    expect((await command(page, 'select Details tab')).tone).toBe('success');
    expect(await page.evaluate(() => window.tabEvents)).toEqual([]); await expect(page.locator('#b')).toBeFocused();
  }
});
test('invalid missing unsafe and multiselectable tab groups refuse without activation', async ({ page }) => {
  for (const change of [
    'e.removeAttribute("aria-selected")', 'e.setAttribute("aria-selected","mixed")', 'e.setAttribute("aria-selected","yes")',
    'e.parentElement.setAttribute("aria-multiselectable","true")', 'e.parentElement.setAttribute("aria-owns","remote")',
    'e.parentElement.removeAttribute("role")', 'document.querySelector("#a").setAttribute("aria-selected","mixed")',
    'e.setAttribute("aria-selected","true")', 'e.disabled=true', 'e.parentElement.inert=true',
    'e.parentElement.setAttribute("aria-readonly","true")', 'e.parentElement.setAttribute("aria-disabled","true")', 'e.hidden=true',
  ]) {
    await setup(page); expect(await page.evaluate(async change => {
      const context = window.tabContext(), e = document.querySelector('#b'); Function('e', change)(e);
      const r = window.tabController.handle('select Details tab', context); return (await (r.followUp ?? r)).tone;
    }, change), change).toBe('error'); expect(await page.evaluate(() => window.tabEvents), change).toEqual([]);
  }
  for (const target of ['<a href="javascript:window.bad=1" role="tab" aria-selected="false">Details</a>', '<input type="checkbox" role="tab" aria-label="Details" aria-selected="false">', '<form><button type="submit" role="tab" aria-selected="false">Details</button></form>']) {
    await setup(page, `<div role="tablist">${target}</div>`); let r = await command(page, 'select Details tab');
    if (r.pending?.kind === 'confirm') r = await command(page, 'confirm');
    expect(r.tone, target).toBe('error'); expect(await page.evaluate(() => window.tabEvents)).toEqual([]);
  }
});
test('focus changes cannot redirect a captured tab action', async ({ page }) => {
  for (const effect of ['e.disabled=true', 'e.readOnly=true', 'e.hidden=true', 'e.setAttribute("aria-label","Other")', 'e.setAttribute("role","button")', 'e.setAttribute("aria-controls","elsewhere")', 'document.querySelector("#elsewhere").append(e)', 'e.replaceWith(e.cloneNode())', 'document.querySelector("#other").focus()']) {
    await setup(page); await page.locator('#b').evaluate((e, effect) => e.addEventListener('focus', () => queueMicrotask(() => Function('e', effect)(e)), { once: true }), effect);
    expect((await command(page, 'select Details tab')).tone, effect).toBe('error'); expect(await page.evaluate(() => window.tabEvents), effect).toEqual([]);
  }
});
test('captured group membership order labels and form ownership cannot drift through confirmation', async ({ page }) => {
  for (const effect of ['document.querySelector("#elsewhere").append(e)', 'e.parentElement.prepend(e)', 'document.querySelector("#a").remove()', 'document.querySelector("#a").setAttribute("aria-label","New name")', 'e.parentElement.setAttribute("aria-label","Other context")', 'e.setAttribute("aria-controls","different-panel")', 'const form=document.createElement("form");document.body.append(form);form.append(e.parentElement)']) {
    await setup(page); expect(await page.evaluate(async effect => {
      const context = window.tabContext(), e = document.querySelector('#b'); Function('e', effect)(e);
      const r = window.tabController.handle('select Details tab', context); return (await (r.followUp ?? r)).tone;
    }, effect), effect).toBe('error'); expect(await page.evaluate(() => window.tabEvents), effect).toEqual([]);
  }
});
test('site refusal reverted selection duplicate selection and removal report failure after one click', async ({ page }) => {
  for (const effect of ['window.selectSiteTab(document.querySelector("#a"))', 'document.querySelector("#a").setAttribute("aria-selected","true")', 'e.setAttribute("role","button")', 'e.hidden=true', 'e.remove()', 'e.replaceWith(e.cloneNode())', 'e.parentElement.setAttribute("aria-disabled","true")']) {
    await setup(page); await page.locator('#b').evaluate((e, effect) => { e.addEventListener('click', () => { queueMicrotask(() => { queueMicrotask(() => { queueMicrotask(() => Function('e', effect)(e)); }); }); }); }, effect);
    expect((await command(page, 'select Details tab')).tone, effect).toBe('error'); expect(await page.evaluate(() => window.tabEvents), effect).toEqual(['b']);
  }
});
test('cancellation pause and newer instructions retire the deferred click as well as feedback', async ({ page }) => {
  for (const said of ['cancel', 'pause', 'help', 'select Overview tab']) {
    await setup(page); expect(await page.evaluate(async said => {
      const r = window.tabController.handle('select Details tab', window.tabContext());
      window.tabController.handle(said, window.tabContext()); return (await r.followUp) === null;
    }, said), said).toBe(true); expect(await page.evaluate(() => window.tabEvents), said).toEqual([]);
    await expect(page.locator('#b')).toHaveAttribute('aria-selected', 'false');
  }
});
test('clarification confirmation and cancel retain exact tab selection intent', async ({ page }) => {
  await setup(page, markup.replaceAll('Details', 'Delete account').replace('Overview', 'Delete account'));
  let r = await command(page, 'select Delete account tab'); expect(r.pending.kind).toBe('clarify');
  r = await command(page, String(r.pending.candidates[1].number)); expect(r.pending.kind).toBe('confirm');
  await command(page, 'cancel'); await command(page, 'confirm'); expect(await page.evaluate(() => window.tabEvents)).toEqual([]);
  r = await command(page, 'select Delete account tab'); await command(page, String(r.pending.candidates[1].number));
  await page.locator('#b').evaluate(e => e.setAttribute('aria-controls', 'changed'));
  expect((await command(page, 'confirm')).tone).toBe('error'); expect(await page.evaluate(() => window.tabEvents)).toEqual([]);
  r = await command(page, 'select Delete account tab'); await command(page, String(r.pending.candidates[1].number));
  expect((await command(page, 'confirm')).tone).toBe('success'); expect(await page.evaluate(() => window.tabEvents)).toEqual(['b']);
});
test('same-origin frame and shadow tabs keep ownership and ancestor locks', async ({ page }) => {
  await setup(page, '<div id="host"></div><iframe id="frame"></iframe>');
  expect(await page.evaluate(async markup => {
    const host = document.querySelector('#host'), root = host.attachShadow({ mode: 'open' }), frame = document.querySelector('#frame');
    root.innerHTML = markup; frame.contentDocument.body.innerHTML = markup;
    const { captureTabSnapshot } = await import('/src/web/page-context.js'); const results = [];
    for (const [scope, ancestor] of [[root, host], [frame.contentDocument, frame]]) {
      const e = scope.querySelector('#b'); e.addEventListener('click', () => { e.setAttribute('aria-selected', 'true'); scope.querySelector('#a').setAttribute('aria-selected', 'false'); });
      const context = { elements: [{ id: 1, element: e, role: 'tab', name: 'Details', tabSnapshot: captureTabSnapshot(e), distance: 0 }] };
      let r = window.tabController.handle('select Details tab', context); r = await (r.followUp ?? r); results.push(r.tone, e.getAttribute('aria-selected'));
      ancestor.setAttribute('aria-disabled', 'true'); r = window.tabController.handle('select Details tab', context); r = await (r.followUp ?? r); results.push(r.tone);
    } return results;
  }, markup)).toEqual(['success', 'true', 'error', 'success', 'true', 'error']);
});
test('hidden already-selected targets refuse stale context without focus or clicks', async ({ page }) => {
  await setup(page); expect(await page.evaluate(async () => {
    const context = window.tabContext(); document.querySelector('#a').hidden = true;
    const r = window.tabController.handle('select Overview tab', context); return (await (r.followUp ?? r)).tone;
  })).toBe('error'); expect(await page.evaluate(() => window.tabEvents)).toEqual([]);
});

test('optional target matching preserves tab intent and waits for actual retained selection', async ({ page }) => {
  await setup(page); expect(await page.evaluate(async () => {
    document.querySelector('#a').textContent = 'Details overview'; document.querySelector('#b').textContent = 'Details advanced';
    const { createAssistedInterpreter } = await import('/src/web/assisted-interpreter.js'), { createController } = await import('/src/web/controller.js');
    let calls = 0;
    const assistant = createAssistedInterpreter({ model: { decide: async () => { calls++; return { probs: [.01, .98, .01] }; } } });
    const controller = createController({ window, assistant }); const r = controller.handle('select Details tab', window.tabContext());
    const done = await (r.followUp ?? r); return { calls, tone: done.tone, performed: done.performed, clicks: window.tabEvents };
  })).toEqual({ calls: 1, tone: 'success', performed: 'select-tab', clicks: ['b'] });
});
