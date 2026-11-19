import {test,expect} from '@playwright/test';
const panel=page=>page.locator('#gaze-web-navigator section');
const status=page=>panel(page).locator('.status');
async function say(page,text){await panel(page).getByLabel('Typed instruction').fill(text);await panel(page).getByRole('button',{name:'Do it',exact:true}).click();}
async function setup(page){
 await page.goto('/practice-site/contact.html');await page.evaluate(()=>{const host=document.getElementById('gaze-web-navigator');for(const child of [...document.body.children])if(child!==host)child.remove();document.body.insertAdjacentHTML('afterbegin','<main><form id="details" style="margin:20px;display:grid;width:300px;gap:8px"><label>First name<input id="first" autocomplete="given-name"></label><label>Last name<input id="last" autocomplete="family-name"></label><label>Email<input id="email" type="email"></label></form><form id="other-form"><input id="other" value="safe"></form></main>');});
 await say(page,'remember my name is Jo Smith');await say(page,'remember my email is jo at example dot com');const box=await page.locator('#first').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await say(page,'fill in my details');await expect(status(page)).toContainText('Fill 3 fields');
}
async function values(page){return page.evaluate(()=>['first','last','email','other'].map(id=>document.getElementById(id)?.value??null));}
for(const mutation of ['value','password','autocomplete','label','form','name','disabled','destination','form label'])test(`confirmation-time ${mutation} changes refuse the entire saved-detail plan`,async({page})=>{
 await setup(page);await page.evaluate(mutation=>{const e=document.querySelector('#last');if(mutation==='value')e.value='My correction';if(mutation==='password')e.type='password';if(mutation==='autocomplete')e.autocomplete='one-time-code';if(mutation==='label')e.setAttribute('aria-label','Security code');if(mutation==='form')e.setAttribute('form','other-form');if(mutation==='name')e.name='new-destination';if(mutation==='disabled')e.disabled=true;if(mutation==='destination')e.form.setAttribute('action','https://different.example/collect');if(mutation==='form label')e.form.setAttribute('aria-label','Different purpose');},mutation);
 await say(page,'confirm');expect(await values(page)).toEqual(['',mutation==='value'?'My correction':'','','safe']);await expect(status(page)).not.toContainText('jo@example.com');
});
for(const mutation of ['value','password','autocomplete','readonly','redirect','form'])test(`focus-time ${mutation} changes stop before saved values are entered`,async({page})=>{
 await setup(page);await page.evaluate(mutation=>document.querySelector('#first').addEventListener('focus',event=>{const e=event.target;if(mutation==='value')e.value='Website draft';if(mutation==='password')e.type='password';if(mutation==='autocomplete')e.autocomplete='cc-number';if(mutation==='readonly')e.readOnly=true;if(mutation==='redirect')document.querySelector('#other').focus();if(mutation==='form')e.setAttribute('form','other-form');},{once:true}),mutation);
 await say(page,'confirm');expect(await values(page)).toEqual([mutation==='value'?'Website draft':'','','','safe']);
});
test('a changed later field stops filling and the earlier partial fill remains safely undoable',async({page})=>{
 await setup(page);await page.evaluate(()=>document.querySelector('#first').addEventListener('input',()=>{document.querySelector('#last').value='Website draft';},{once:true}));await say(page,'confirm');expect(await values(page)).toEqual(['Jo','Website draft','','safe']);await expect(status(page)).toContainText('Stopped');await say(page,'undo');expect(await values(page)).toEqual(['','Website draft','','safe']);
});
for(const action of ['pause','cancel'])test(`an input-time ${action} stops the remaining fill without reverting earlier values`,async({page})=>{
 await setup(page);await page.evaluate(action=>document.querySelector('#first').addEventListener('input',()=>document.getElementById('gaze-web-navigator').shadowRoot.querySelector(`.${action}`).click(),{once:true}),action);await say(page,'confirm');expect(await values(page)).toEqual(['Jo','','','safe']);await expect(status(page)).not.toContainText('Filled First name, Last name and Email');
});
test('Undo preserves later corrections and clears only fields still holding the filled values',async({page})=>{
 await setup(page);await say(page,'confirm');expect(await values(page)).toEqual(['Jo','Smith','jo@example.com','safe']);await page.locator('#last').fill('My correction');await say(page,'undo');expect(await values(page)).toEqual(['','My correction','','safe']);await expect(status(page)).toContainText('Kept');
});
test('a focus-time correction during Undo stops before overwriting it or clearing other fields',async({page})=>{
 await setup(page);await say(page,'confirm');await page.evaluate(()=>{document.querySelector('#other').focus();document.querySelector('#first').addEventListener('focus',e=>{e.target.value='My correction';},{once:true});});await say(page,'undo');expect(await values(page)).toEqual(['My correction','Smith','jo@example.com','safe']);expect(await status(page).textContent()).toContain('Kept changed or unavailable fields (First name)');expect(await status(page).textContent()).toContain('Fields not yet restored (Last name and Email)');
});
test('a rejected Undo stops the remaining restore and can be retried explicitly',async({page})=>{
 await setup(page);await say(page,'confirm');await page.evaluate(()=>document.querySelector('#first').addEventListener('input',e=>{e.target.value='Jo';},{once:true}));await say(page,'undo');expect(await values(page)).toEqual(['Jo','Smith','jo@example.com','safe']);await say(page,'undo');expect(await values(page)).toEqual(['','','','safe']);
});
test('Undo reconciles earlier fields changed by a later input handler and retains a retry',async({page})=>{
 await setup(page);await say(page,'confirm');await page.evaluate(()=>document.querySelector('#last').addEventListener('input',()=>{document.querySelector('#first').value='Jo';},{once:true}));
 await say(page,'undo');expect(await values(page)).toEqual(['Jo','','jo@example.com','safe']);
 expect(await status(page).textContent()).not.toContain('Emptied First name');expect(await status(page).textContent()).toContain('not yet restored');
 await say(page,'undo');expect(await values(page)).toEqual(['','','','safe']);
});
for(const mutation of ['resolved destination','referenced form label','fieldset meaning'])for(const operation of ['fill','undo'])test(`${operation} refuses changed ${mutation}`,async({page})=>{
 await setup(page);await say(page,'cancel');await page.evaluate(mutation=>{
  const form=document.querySelector('#details');
  if(mutation==='resolved destination'){const base=document.createElement('base');base.href=location.origin+'/before/';document.head.append(base);form.setAttribute('action','collect');}
  if(mutation==='referenced form label'){form.insertAdjacentHTML('afterbegin','<h2 id="purpose">Your details</h2>');form.setAttribute('aria-labelledby','purpose');}
  if(mutation==='fieldset meaning'){const fieldset=document.createElement('fieldset');fieldset.innerHTML='<legend>Your details</legend>';form.append(fieldset);fieldset.append(document.querySelector('#first').parentElement);}
 },mutation);await say(page,'fill in my details');if(operation==='undo')await say(page,'confirm');
 await page.evaluate(mutation=>{if(mutation==='resolved destination')document.querySelector('base').href=location.origin+'/after/';if(mutation==='referenced form label')document.querySelector('#purpose').textContent='Someone else';if(mutation==='fieldset meaning')document.querySelector('legend').textContent='Other person';},mutation);
 await say(page,operation==='fill'?'confirm':'undo');expect(await values(page)).toEqual(operation==='fill'?['','','','safe']:mutation==='fieldset meaning'?['Jo','','','safe']:['Jo','Smith','jo@example.com','safe']);
});
test('a whitespace draft is preserved and omitted from the fill preview',async({page})=>{
 await setup(page);await say(page,'cancel');await page.locator('#first').fill(' ');await say(page,'fill in my details');expect(await status(page).textContent()).toContain('Fill 2 fields');await say(page,'confirm');expect(await values(page)).toEqual([' ','Smith','jo@example.com','safe']);
});
for(const when of ['before preview','after preview'])test(`an unfinished numeric draft ${when} is never filled`,async({page})=>{
 await setup(page);await say(page,'cancel');await say(page,'remember my postcode is 12345');await page.evaluate(()=>{const first=document.querySelector('#first');first.type='number';first.autocomplete='postal-code';first.parentElement.firstChild.textContent='Postcode';});
 if(when==='after preview')await say(page,'fill in my details');await page.locator('#first').focus();await page.keyboard.type('-');expect(await page.locator('#first').evaluate(e=>e.validity.badInput)).toBe(true);
 if(when==='before preview')await say(page,'fill in my details');await say(page,'confirm');expect((await values(page))[0]).toBe('');expect(await page.locator('#first').evaluate(e=>e.validity.badInput)).toBe(true);
});
for(const protection of ['aria-readonly','ONE-TIME-CODE','cc-name'])test(`initial ${protection} fields are excluded while writable details still fill`,async({page})=>{
 await setup(page);await say(page,'cancel');await page.evaluate(protection=>{const first=document.querySelector('#first');if(protection==='aria-readonly')first.setAttribute('aria-readonly','true');else{first.autocomplete=protection;first.parentElement.firstChild.textContent=protection==='cc-name'?'Name on card':'Email verification code';}},protection);
 await say(page,'fill in my details');expect(await status(page).textContent()).toContain('Fill 2 fields');await say(page,'confirm');expect(await values(page)).toEqual(['','Smith','jo@example.com','safe']);
});
test('saved values embedded in page labels stay out of preview, partial fill and Undo feedback',async({page})=>{
 await setup(page);await say(page,'cancel');await page.evaluate(()=>{document.querySelector('#email').setAttribute('aria-label','Email for jo@example.com');document.querySelector('#first').setAttribute('aria-label','First name for SMITH');});await say(page,'fill in my details');
 expect(await status(page).textContent()).not.toMatch(/jo@example.com|SMITH/i);
 await page.evaluate(()=>document.querySelector('#email').addEventListener('input',()=>{document.querySelector('#last').value='Correction';},{once:true}));await say(page,'confirm');expect(await status(page).textContent()).not.toMatch(/jo@example.com|SMITH/i);await say(page,'undo');expect(await status(page).textContent()).not.toMatch(/jo@example.com|SMITH/i);
});
test('a newer fill preview keeps its prompt and spoken feedback after an older fill returns',async({page})=>{
 await page.addInitScript(()=>{window.detailSpeech=[];window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{cancel(){},speak(utterance){detailSpeech.push(utterance.text);}}});});
 await setup(page);await panel(page).getByText('Tracking and settings',{exact:true}).click();await panel(page).getByLabel('Speak feedback',{exact:true}).check();
 await page.evaluate(()=>document.querySelector('#first').addEventListener('input',()=>{const shadow=document.getElementById('gaze-web-navigator').shadowRoot;shadow.querySelector('.instruction').value='fill in my details';shadow.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));},{once:true}));
 await say(page,'confirm');expect(await values(page)).toEqual(['Jo','','','safe']);expect(await status(page).textContent()).toContain('Fill 2 fields');expect(await page.evaluate(()=>detailSpeech.at(-1))).toContain('Fill 2 fields');await say(page,'confirm');expect(await values(page)).toEqual(['Jo','Smith','jo@example.com','safe']);
});
