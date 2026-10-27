import { test, expect } from '@playwright/test';

// Dictation into rich-text editors must keep their formatting and links.
const markup = `<div id="editor" contenteditable="true" aria-label="Message"><p><b>Hello</b> <a href="#team">team</a>, see you soon</p></div>`;

async function setup(page) {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async markup => {
    document.body.innerHTML = markup;
    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    window.controller = createController({ window });
    window.inputs = [];
    document.addEventListener('input', event => window.inputs.push(event.inputType));
    window.say = async text => {
      const context = captureContext(document, { x: 20, y: 20, radius: 1000 });
      const result = window.controller.handle(text, context);
      return await (result.followUp ?? result);
    };
  }, markup);
  await page.locator('#editor').focus();
}

const structure = page => page.locator('#editor').evaluate(editor => ({
  // Editors keep a trailing space visible as a no-break space.
  text: editor.textContent.replace(/\u00a0/g, ' '),
  bold: editor.querySelector('b')?.textContent ?? null,
  link: editor.querySelector('a')?.textContent ?? null,
  href: editor.querySelector('a')?.getAttribute('href') ?? null,
}));

test('appending keeps bold text and links', async ({ page }) => {
  await setup(page);
  expect((await page.evaluate(() => window.say('type tomorrow'))).tone).toBe('success');
  expect(await structure(page)).toEqual({ text: 'Hello team, see you soon tomorrow', bold: 'Hello', link: 'team', href: '#team' });
  expect(await page.evaluate(() => window.inputs)).toContain('insertText');
});

test('replacing a word and undoing keep the surrounding formatting', async ({ page }) => {
  await setup(page);
  expect((await page.evaluate(() => window.say('replace soon with later'))).tone).toBe('success');
  expect(await structure(page)).toEqual({ text: 'Hello team, see you later', bold: 'Hello', link: 'team', href: '#team' });
  expect((await page.evaluate(() => window.say('undo'))).tone).toBe('success');
  expect(await structure(page)).toEqual({ text: 'Hello team, see you soon', bold: 'Hello', link: 'team', href: '#team' });
});

test('a site that blocks native editing still gets only the changed span', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => document.addEventListener('beforeinput', event => event.preventDefault(), { capture: true }));
  expect((await page.evaluate(() => window.say('type tomorrow'))).tone).toBe('success');
  expect(await structure(page)).toEqual({ text: 'Hello team, see you soon tomorrow', bold: 'Hello', link: 'team', href: '#team' });
});

const selected = page => page.evaluate(() => document.getSelection().toString());

test('selecting words and replacing them keeps the surrounding formatting', async ({ page }) => {
  await setup(page);
  expect((await page.evaluate(() => window.say('select text see you'))).tone).toBe('success');
  expect(await selected(page)).toBe('see you');
  expect((await page.evaluate(() => window.say('replace selected text with meet you'))).tone).toBe('success');
  expect(await structure(page)).toEqual({ text: 'Hello team, meet you soon', bold: 'Hello', link: 'team', href: '#team' });
  expect((await page.evaluate(() => window.say('move the cursor to the end'))).tone).toBe('success');
  expect((await page.evaluate(() => window.say('insert there at the cursor'))).tone).toBe('success');
  expect((await structure(page)).text).toBe('Hello team, meet you soonthere');
});

test('deleting selected words keeps the formatting and can be undone, even after focus moved away', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<input id="elsewhere" aria-label="Elsewhere">'));
  expect((await page.evaluate(() => window.say('select text soon'))).tone).toBe('success');
  // Typing an instruction elsewhere (as into the navigator's panel) moves focus and the page's selection.
  await page.locator('#elsewhere').focus();
  const deleted = await page.evaluate(() => window.say('delete the selected text'));
  expect(deleted.tone).toBe('success');
  expect(await structure(page)).toEqual({ text: 'Hello team, see you ', bold: 'Hello', link: 'team', href: '#team' });
  expect((await page.evaluate(() => window.say('undo'))).tone).toBe('success');
  expect(await structure(page)).toEqual({ text: 'Hello team, see you soon', bold: 'Hello', link: 'team', href: '#team' });
});
