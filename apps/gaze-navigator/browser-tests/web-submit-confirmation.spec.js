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

test('search keeps its captured native destination before and during query entry', async ({page}) => {
  await page.route('**/search-binding-fixture', route => route.fulfill({contentType:'text/html',body:`<!doctype html><form id="approved" action="/approved"><label>Search books<input id="search" type="search" name="q" value="Keep me"></label><label>Message<input id="message" name="message" value="Keep message"></label></form><form id="other" action="/other"></form><div role="searchbox" contenteditable="true" hidden id="editable">Old query</div>`}));
  await page.goto('/search-binding-fixture');
  const result=await page.evaluate(async()=>{
    const {captureContext}=await import('/src/web/page-context.js');
    const {createController}=await import('/src/web/controller.js');
    const form=document.querySelector('#approved'), field=document.querySelector('#search'), message=document.querySelector('#message');
    const events=[]; document.addEventListener('submit',e=>{e.preventDefault();events.push(e.target.id);});
    const contextFor=target=>{const r=target.getBoundingClientRect();return captureContext(document,{x:r.x+r.width/2,y:r.y+r.height/2,radius:15});};
    const controller=createController({window});
    field.hidden=true; message.focus(); const context=contextFor(message);
    const prompt=controller.handle('find replacement',context); form.action='/changed';
    const refused=controller.handle('confirm',context); const prewrite=message.value; const preUndo=controller.handle('undo',context).message;
    field.hidden=false; form.setAttribute('action','/approved');
    const mutations=[()=>form.setAttribute('action','/changed'),()=>form.setAttribute('method','post'),()=>form.setAttribute('target','_blank'),()=>field.setAttribute('form','other'),()=>field.setAttribute('aria-label','Send confidential message'),()=>{field.disabled=true;}];
    const responses=[]; let undoValue;
    for(const mutate of mutations){
      field.value='Keep me'; const snapshot=contextFor(field);
      field.addEventListener('input',mutate,{once:true});
      responses.push(controller.handle('search for river',snapshot).message);
      if(responses.length===1){controller.handle('undo',contextFor(field));undoValue=field.value;}
      form.setAttribute('action','/approved'); form.removeAttribute('method'); form.removeAttribute('target'); field.removeAttribute('form');field.removeAttribute('aria-label');field.disabled=false;
    }
    field.addEventListener('input',()=>controller.handle('pause',contextFor(field)),{once:true});
    const stopped=controller.handle('search for lakes',contextFor(field));
    const countBefore=events.length; controller.handle('resume',contextFor(field));
    const success=controller.handle('search for mountains',contextFor(field));
    field.hidden=true; message.hidden=true;
    const editable=document.querySelector('#editable'), enters=[]; editable.hidden=false;
    editable.addEventListener('keydown',e=>enters.push(e.key));
    const fallback=controller.handle('search for ocean',contextFor(editable));
    return {prompt:prompt.tone,refused:refused.message,prewrite,preUndo,undoValue,responses,stopped:stopped.message,countBefore,success:success.message,events,fallback:fallback.message,query:editable.textContent,enters};
  });
  expect(result.prompt).toBe('question');expect(result.refused).toContain('form changed');expect(result.prewrite).toBe('Keep message');expect(result.preUndo).toContain('Nothing to undo');expect(result.undoValue).toBe('Keep me');
  for(const reply of result.responses)expect(reply).toContain('Nothing was submitted');
  expect(result.countBefore).toBe(0);expect(result.stopped).toContain('stopped');
  expect(result.success).toBe('Searching for "mountains".');expect(result.events).toEqual(['approved']);
  expect(result.fallback).toBe('Searching for "ocean".');expect(result.query).toBe('ocean');expect(result.enters).toEqual(['Enter']);
});
