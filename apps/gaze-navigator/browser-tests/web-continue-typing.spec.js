import { test, expect } from '@playwright/test';

test('captured continuation cannot regain a field after page focus changes', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<input id="message" aria-label="Message" value="one"><input id="other" aria-label="Other" value="safe">';
    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    const field = document.querySelector('#message'), other = document.querySelector('#other');
    field.focus(); const context = captureContext(document, { x: 40, y: 400, radius: 30, focus: field });
    const controller = createController({ window, interpret: () => ({ type: 'edit', targetId: 200, edit: { kind: 'append', text: 'two' }, requireFocus: true }) });
    other.focus(); const reply = controller.handle('continue typing two', context);
    return { tone: reply.tone, message: field.value, other: other.value, focus: document.activeElement.id };
  });
  expect(result).toEqual({ tone: 'error', message: 'one', other: 'safe', focus: 'other' });
});

for (const kind of ['input', 'textarea', 'rich']) test(`${kind}: explicit continuation after drift and per-field Undo keep nearby fields untouched`, async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  const result = await page.evaluate(async kind => {
    const markup = kind === 'rich' ? '<div id="message" role="textbox" contenteditable="true"><b>one</b></div>' : `<${kind} id="message" aria-label="Message"></${kind}>`;
    document.body.innerHTML = markup + '<input id="other" aria-label="Other" value="safe" style="position:fixed;left:20px;top:300px">';
    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    const field = document.querySelector('#message'), other = document.querySelector('#other');
    if (kind !== 'rich') field.value = 'one';
    field.focus(); const controller = createController({ window });
    const capture = () => captureContext(document, { x: 30, y: 310, radius: 40, focus: field });
    const reply = controller.handle('continue typing two into the park', capture());
    const read = () => kind === 'rich' ? field.textContent : field.value;
    const after = read();
    // Undo typing uses focus only when no other text field is gazed; bare undo retains its old scope.
    const away = captureContext(document, { x: 300, y: 400, radius: 20, focus: field });
    const undone = controller.handle('undo typing', away);
    return { tone: reply.tone, after, undone: undone.tone, restored: read(), other: other.value };
  }, kind);
  expect(result).toEqual({ tone: 'success', after: 'one two into the park', undone: 'success', restored: 'one', other: 'safe' });
});

test('the overlay preserves page focus while entering an explicit continuation into its own typed box', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  const panel = page.locator('#gaze-web-navigator section');
  await expect(panel.getByLabel('Typed instruction')).toBeVisible();
  await page.evaluate(() => { const field = document.createElement('input'); field.id='continue-message'; field.setAttribute('aria-label','Continue message'); field.value='one'; field.style.cssText='position:fixed;left:10px;top:10px;width:100px;z-index:1'; document.body.append(field); field.focus(); });
  await page.mouse.move(300, 250);
  await panel.getByLabel('Typed instruction').fill('continue typing two');
  await panel.getByRole('button', { name: 'Do it', exact: true }).click();
  await expect(page.locator('#continue-message')).toHaveValue('one two');
});

for (const state of ['readonly', 'password', 'disconnected']) test(`continuation refuses a captured field that becomes ${state}`, async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  const result = await page.evaluate(async state => {
    document.body.innerHTML = '<input id="message" aria-label="Message" value="one">';
    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    const field = document.querySelector('#message'); field.focus();
    const context = captureContext(document, { x: 300, y: 400, radius: 20, focus: field });
    if (state === 'readonly') field.readOnly = true;
    if (state === 'password') field.type = 'password';
    if (state === 'disconnected') field.remove();
    const reply = createController({ window }).handle('continue typing private', context);
    return { tone: reply.tone, value: field.value, text: reply.message };
  }, state);
  expect(result.tone).toBe('error'); expect(result.value).toBe('one'); expect(result.text).not.toContain('private');
});

test('refused continuation Undo retains the original per-field history', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<input id="message" value="one"><input id="other" value="safe">';
    const { captureContext } = await import('/src/web/page-context.js'); const { createController } = await import('/src/web/controller.js');
    const field = document.querySelector('#message'), other = document.querySelector('#other'), controller = createController({ window });
    const capture = () => captureContext(document, { x: 300, y: 400, radius: 20, focus: field });
    field.focus(); controller.handle('continue typing two', capture()); const old = capture();
    other.focus(); const refused = controller.handle('undo typing', old); const kept = field.value;
    field.focus(); const accepted = controller.handle('undo typing', capture());
    return { refused: refused.tone, kept, accepted: accepted.tone, final: field.value, other: other.value };
  });
  expect(result).toEqual({ refused: 'error', kept: 'one two', accepted: 'success', final: 'one', other: 'safe' });
});

for (const kind of ['shadow', 'frame']) test(`continuation follows the native focused ${kind} field and refuses focus outside its root`, async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  const result = await page.evaluate(async kind => {
    document.body.innerHTML = '<input id="other" value="safe">';
    let field;
    if (kind === 'shadow') { const host=document.createElement('div'); document.body.append(host); host.attachShadow({mode:'open'}).innerHTML='<input value="one">'; field=host.shadowRoot.querySelector('input'); }
    else { const frame=document.createElement('iframe'); const loaded=new Promise(resolve=>frame.onload=resolve); frame.srcdoc='<input value="one">'; document.body.append(frame); await loaded; field=frame.contentDocument.querySelector('input'); }
    const { captureContext } = await import('/src/web/page-context.js'); const { createController } = await import('/src/web/controller.js');
    field.focus(); const controller=createController({window}), capture=()=>captureContext(document,{x:300,y:400,radius:20,focus:field});
    const reply=controller.handle('continue typing two',capture()), old=capture(); document.querySelector('#other').focus(); const refused=controller.handle('continue typing three',old);
    return {tone:reply.tone,value:field.value,refused:refused.tone,other:document.querySelector('#other').value};
  },kind);
  expect(result).toEqual({tone:'success',value:'one two',refused:'error',other:'safe'});
});

for (const mutation of ['readonly', 'password', 'disconnected', 'redirect', 'value']) test(`overlay continuation rechecks a site focus handler that changes ${mutation}`, async ({ page }) => {
  await page.goto('/practice-site/contact.html'); const panel=page.locator('#gaze-web-navigator section');
  await expect(panel.getByLabel('Typed instruction')).toBeVisible();
  await page.evaluate(mutation=>{
    const field=document.createElement('input'), other=document.createElement('input'); field.value='one'; field.id='focus-race'; field.setAttribute('aria-label','Message'); field.style.cssText='position:fixed;left:10px;top:10px;width:100px'; other.value='safe'; other.id='focus-other';document.body.append(field,other);field.focus();window.raceField=field;
    field.addEventListener('focus',()=>{ if(mutation==='readonly')field.readOnly=true; if(mutation==='password')field.type='password'; if(mutation==='disconnected')field.remove(); if(mutation==='redirect')other.focus(); if(mutation==='value')field.value='site update'; },{once:true});
  },mutation);
  await page.mouse.move(300,250); await panel.getByLabel('Typed instruction').fill('continue typing private'); await panel.getByRole('button',{name:'Do it',exact:true}).click();
  const result=await page.evaluate(()=>({value:window.raceField.value,other:document.querySelector('#focus-other').value,text:document.querySelector('#gaze-web-navigator').shadowRoot.textContent}));
  expect(result.value).toBe(mutation==='value'?'site update':'one'); expect(result.other).toBe('safe');
  // The typed command stays in an input's value, never a visible/spoken result string.
  expect(result.text).not.toContain('one private');
});

test('a site focus lock during overlay Undo does not consume text history', async ({ page }) => {
  await page.goto('/practice-site/contact.html'); const panel=page.locator('#gaze-web-navigator section');
  await page.evaluate(()=>{document.querySelectorAll('input,textarea,[contenteditable=true]').forEach(node=>node.remove());const field=document.createElement('input');field.id='undo-focus-race';field.value='one';field.style.cssText='position:fixed;left:10px;top:10px;width:100px';document.body.append(field);field.focus();});
  await page.mouse.move(300,250); const command=panel.getByLabel('Typed instruction'), go=panel.getByRole('button',{name:'Do it',exact:true});
  await command.fill('continue typing two');await go.click();await expect(page.locator('#undo-focus-race')).toHaveValue('one two');
  await page.evaluate(()=>{const field=document.querySelector('#undo-focus-race');field.addEventListener('focus',()=>{field.readOnly=true;},{once:true});});
  await command.fill('undo typing');await go.click();await expect(page.locator('#undo-focus-race')).toHaveValue('one two');await expect(page.locator('#undo-focus-race')).toHaveAttribute('readonly','');
  await page.evaluate(()=>{document.querySelector('#undo-focus-race').readOnly=false;});
  await command.fill('undo typing');await go.click();await expect(page.locator('#undo-focus-race')).toHaveValue('one');
});
