import { test, expect } from '@playwright/test';
async function setup(page, rich = false) {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async rich => {
    document.body.innerHTML = rich
      ? '<div id="field" role="textbox" aria-label="Message" contenteditable="true"><b>Draft</b></div><input id="other" value="safe">'
      : '<label>Message<input id="field" value="Draft"></label><input id="other" value="safe">';
    const { createController } = await import('/src/web/controller.js');
    const { captureContext } = await import('/src/web/page-context.js');
    window.editController = createController({ window });
    window.editCapture = () => {
      const rect = document.querySelector('#field').getBoundingClientRect();
      return captureContext(document, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, radius: 20 });
    };
    window.editEvents = [];
    for (const event of ['input', 'change']) document.querySelector('#field').addEventListener(event, () => editEvents.push(event));
  }, rich);
}

for (const effect of ['readonly', 'disabled', 'aria lock', 'inert', 'password', 'payment', 'detach', 'redirect', 'value', 'cancel', 'pause']) {
  test(`ordinary typing refuses focus-time ${effect} without text events`, async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(effect => {
      const field = document.querySelector('#field');
      field.addEventListener('focus', () => {
        if (effect === 'readonly') field.readOnly = true;
        if (effect === 'disabled') field.disabled = true;
        if (effect === 'aria lock') field.parentElement.setAttribute('aria-readonly', 'true');
        if (effect === 'inert') field.parentElement.inert = true;
        if (effect === 'password') field.type = 'password';
        if (effect === 'payment') field.autocomplete = 'cc-number';
        if (effect === 'detach') field.remove();
        if (effect === 'redirect') document.querySelector('#other').focus();
        if (effect === 'value') field.value = 'Website update';
        if (effect === 'cancel' || effect === 'pause') editController.handle(effect, { elements: [] });
      }, { once: true });
      const reply = editController.handle('type hello', editCapture());
      return { reply, value: field.value, events: editEvents, other: document.querySelector('#other').value };
    }, effect);
    expect(result.reply.tone).toBe('error'); expect(result.reply.performed ?? null).toBeNull();
    expect(result.events).toEqual([]); expect(result.other).toBe('safe');
    expect(result.value).toBe(effect === 'value' ? 'Website update' : 'Draft');
  });
}

for (const rich of [false, true]) test(`${rich ? 'rich' : 'native'} refused typing Undo keeps history for a later explicit retry`, async ({ page }) => {
  await setup(page, rich);
  const result = await page.evaluate(rich => {
    const field = document.querySelector('#field');
    editController.handle('type hello', editCapture()); document.querySelector('#other').focus();
    field.addEventListener('focus', () => { if (rich) field.contentEditable = 'false'; else field.readOnly = true; }, { once: true });
    const denied = editController.handle('undo typing', editCapture());
    const afterRefusal = rich ? field.textContent : field.value;
    if (rich) field.contentEditable = 'true'; else field.readOnly = false;
    const restored = editController.handle('undo typing', editCapture());
    return { denied, afterRefusal, restored, value: rich ? field.textContent : field.value, markup: field.innerHTML };
  }, rich);
  expect(result.denied.tone).toBe('error'); expect(result.afterRefusal).toBe('Draft hello');
  expect(result.restored.tone).toBe('success'); expect(result.value).toBe('Draft');
  if (rich) expect(result.markup).toBe('<b>Draft</b>');
});

test('protected typing still works and input-time protection redacts the resulting reply', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const field = document.querySelector('#field'); field.type = 'password';
    const original = editController.handle('type secret', editCapture());
    field.type = 'text';
    field.addEventListener('input', () => { field.type = 'password'; }, { once: true });
    const changed = editController.handle('type hidden', editCapture());
    return { original, changed, value: field.value };
  });
  expect(result.value).toBe('Draft secret hidden');
  expect(result.original.message).toContain('hidden'); expect(result.original.message).not.toContain('secret');
  expect(result.changed.message).toContain('Its text is hidden'); expect(result.changed.message).not.toContain('Draft');
});

test('rich replacement keeps the selected words after focus and selection move to command entry', async ({ page }) => {
  await setup(page, true);
  const result = await page.evaluate(() => {
    const field = document.querySelector('#field'); field.innerHTML = '<b>Hello</b> team soon';
    editController.handle('select text soon', editCapture());
    const other = document.querySelector('#other'); other.focus(); other.select();
    const reply = editController.handle('replace selected text with later', editCapture());
    return { reply, value: field.textContent, bold: field.querySelector('b')?.textContent, other: other.value };
  });
  expect(result.reply.tone).toBe('success'); expect(result.value).toBe('Hello team later');
  expect(result.bold).toBe('Hello'); expect(result.other).toBe('safe');
});

test('newly protected text is hidden in visible and spoken overlay feedback', async ({ page }) => {
  await page.addInitScript(() => {
    window.editOutput = [];
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak(utterance) { editOutput.push(utterance.text); } } });
  });
  await page.goto('/practice-site/contact.html');
  await page.evaluate(() => {
    const label = document.createElement('label'); label.textContent = 'Private message';
    label.style.cssText = 'position:fixed;top:8px;left:8px;background:white;z-index:2';
    const field = document.createElement('input'); field.id = 'protected-edit'; field.value = 'Draft';
    field.addEventListener('input', () => { field.type = 'password'; }, { once: true }); label.append(field); document.body.append(label);
  });
  const p = page.locator('#gaze-web-navigator section');
  await p.getByText('Tracking and settings', { exact: true }).click(); await p.getByLabel('Speak feedback', { exact: true }).check();
  const box = await page.locator('#protected-edit').boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.getByLabel('Typed instruction', { exact: true }).fill('type secret'); await p.getByRole('button', { name: 'Do it', exact: true }).click();
  await expect(p.locator('.status')).toContainText('Its text is hidden'); await expect(p.locator('.status')).not.toContainText('secret');
  expect(await page.evaluate(() => window.editOutput.at(-1))).not.toContain('secret');
});
