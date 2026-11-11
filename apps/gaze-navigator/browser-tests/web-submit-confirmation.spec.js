import { test, expect } from '@playwright/test';

test('confirmed submission keeps its captured form binding and native options', async ({ page }) => {
  await page.route('**/submit-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <base href="/approved-base/"><form id="primary" action="" method="post"><label>Message <input id="message" name="message" value="Keep these words"></label></form>
    <form id="other" action="/other"></form><fieldset id="holder"><button id="send" style="position:absolute;top:240px" type="submit" form="primary" formaction="/button">Send message</button></fieldset>` }));
  await page.goto('/submit-fixture');
  const result = await page.evaluate(async () => {
    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    const form = document.querySelector('#primary'), field = document.querySelector('#message'), button = document.querySelector('#send');
    const controller = createController({ window }), events = [];
    document.addEventListener('submit', event => { event.preventDefault(); events.push([event.target.id, event.submitter?.id ?? null]); });
    const begin = target => {
      const rect = target.getBoundingClientRect();
      const context = captureContext(document, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, radius: 35 });
      return [context, controller.handle('submit', context).tone];
    };
    const mutations = [
      [field, form, 'action', '/unapproved'], [field, form, 'action', '\u00a0'],
      [field, form, 'method', 'get'], [field, form, 'target', '_blank'],
      [field, form, 'enctype', 'text/plain'], [field, form, 'accept-charset', 'windows-1252'],
      [field, form, 'rel', 'opener'], [field, field, 'form', 'other'],
      [button, button, 'formaction', '/unapproved'], [button, document.querySelector('#holder'), 'disabled', ''],
    ];
    const refused = [];
    for (const [control, owner, attribute, value] of mutations) {
      const old = owner.getAttribute(attribute), [context, prompt] = begin(control);
      owner.setAttribute(attribute, value);
      refused.push([prompt, controller.handle('confirm', context).message, events.length]);
      if (old === null) owner.removeAttribute(attribute); else owner.setAttribute(attribute, old);
    }
    for (const control of [field, button]) {
      const [context, prompt] = begin(control);
      refused.push([prompt, controller.handle('confirm', context).message, events.length]);
    }
    return { refused, events, value: field.value };
  });
  for (const [prompt, message, count] of result.refused.slice(0, 10)) {
    expect(prompt).toBe('question');
    expect(message).toContain('The form changed');
    expect(count).toBe(0);
  }
  expect(result.refused.slice(10).map(([prompt, message]) => [prompt, message])).toEqual(Array(2).fill(['question', 'Form submitted.']));
  expect(result.events).toEqual([['primary', null], ['primary', 'send']]);
  expect(result.value).toBe('Keep these words');
});

test('a dialog form cannot close a different dialog after confirmation', async ({ page }) => {
  await page.route('**/dialog-submit-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <dialog open id="first" style="margin:0"><form method="dialog"><label>Answer <input name="answer"></label></form></dialog>
    <dialog open id="second" style="top:200px;margin:0"><p>Other dialog</p></dialog>` }));
  await page.goto('/dialog-submit-fixture');
  const result = await page.evaluate(async () => {
    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    const controller = createController({ window }), field = document.querySelector('input');
    const rect = field.getBoundingClientRect();
    const context = captureContext(document, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, radius: 35 });
    const prompt = controller.handle('submit', context);
    const [first, second] = document.querySelectorAll('dialog');
    second.append(document.querySelector('form'));
    const answer = controller.handle('confirm', context);
    return [prompt.tone, answer.message, first.open, second.open];
  });
  expect(result).toEqual(['question', expect.stringContaining('The form changed'), true, true]);
});
