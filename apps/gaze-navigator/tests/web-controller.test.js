import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../src/web/controller.js';

function fakePage() {
  const log = [];
  const values = new Map();
  const node = name => ({ name, isConnected: true });
  const actions = {
    activate: (element, name) => { log.push(['activate', name]); return { ok: true, message: `${name} activated.` }; },
    submit: element => { log.push(['submit', element.name]); return { ok: true, message: 'Form submitted.' }; },
    selectOption: (element, index) => { log.push(['option', index]); return { ok: true, message: 'selected' }; },
    scroll: (region, direction) => { log.push(['scroll', region, direction]); return { ok: true, message: `scrolled ${direction}` }; },
    navigate: (window, direction) => { log.push([direction]); return { ok: true, message: direction }; },
    readValue: element => values.get(element) ?? '',
    writeValue: (element, value) => { log.push(['write', element.name, value]); values.set(element, value); },
  };
  return { log, values, actions, node };
}

const describe = (id, element, extra = {}) => ({ id, element, name: element.name, role: 'button', distance: id === 1 ? 0 : 20, editable: false, consequential: false, ...extra });

test('ordinary actions run immediately; consequential ones wait for confirmation', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, page.node('Pricing'), { role: 'link' }), describe(2, page.node('Delete account'), { consequential: true })], region: 'page' };
  assert.equal(controller.handle('open pricing', context).performed, 'activate');
  const waiting = controller.handle('delete account', context);
  assert.equal(waiting.tone, 'question');
  assert.deepEqual(waiting.pending, { kind: 'confirm', candidates: null });
  assert.equal(page.log.length, 1, 'nothing ran before confirmation');
  assert.equal(controller.handle('confirm', { elements: [] }).performed, 'activate');
  assert.deepEqual(page.log.at(-1), ['activate', 'Delete account']);
});

test('denying, cancelling, rephrasing or waiting too long never performs the pending action', () => {
  const page = fakePage();
  let clock = 0;
  const controller = createController({ window: {}, actions: page.actions, now: () => clock, confirmMs: 1000 });
  const context = { elements: [describe(1, page.node('Place order'), { consequential: true }), describe(2, page.node('Help'))] };
  for (const answer of ['no', 'cancel', 'open help']) {
    controller.handle('place order', context);
    controller.handle(answer, context);
    controller.handle('yes', context);
  }
  assert.deepEqual(page.log, [['activate', 'Help']], 'a new instruction replaces the confirmation');
  controller.handle('place order', context);
  clock = 1001;
  assert.match(controller.handle('confirm', context).message, /expired/);
  assert.deepEqual(page.log, [['activate', 'Help']]);
});

test('clarification accepts only offered numbers and then performs the chosen action', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, page.node('Read more'), { role: 'link' }), describe(2, page.node('Read more'), { role: 'link' }), describe(3, page.node('Contact'))] };
  const asked = controller.handle('read more', context);
  assert.equal(asked.pending.kind, 'clarify');
  assert.match(controller.handle('3', { elements: [] }).message, /Say one of 1, 2/);
  const done = controller.handle('two', { elements: [] });
  assert.equal(done.performed, 'activate');
  assert.equal(page.log.length, 1);
  assert.equal(controller.pending, null);
});

test('a clarified consequential choice still needs confirmation', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, page.node('Remove item'), { consequential: true }), describe(2, page.node('Remove item'), { consequential: true })] };
  controller.handle('remove item', context);
  assert.equal(controller.handle('1', { elements: [] }).pending.kind, 'confirm');
  assert.equal(page.log.length, 0);
  controller.handle('yes', { elements: [] });
  assert.equal(page.log.length, 1);
});

test('pause blocks every action except resume and cancel', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, page.node('Pricing'))], region: 'page' };
  assert.equal(controller.handle('pause', context).paused, true);
  for (const said of ['open pricing', 'scroll down', 'go back', '1']) assert.match(controller.handle(said, context).message, /Paused/);
  assert.equal(page.log.length, 0);
  controller.handle('resume', context);
  controller.handle('scroll down', context);
  assert.deepEqual(page.log, [['scroll', 'page', 'down']]);
});

test('field edits keep an undo history and report impossible corrections', () => {
  const page = fakePage();
  const field = page.node('Message');
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, field, { role: 'textbox', editable: true })], focusedId: 1 };
  controller.handle('type see you Tuesday', context);
  controller.handle('replace Tuesday with Friday', context);
  assert.equal(page.values.get(field), 'see you Friday');
  assert.match(controller.handle('replace Monday with Sunday', context).message, /"Monday" was not found in Message/);
  controller.handle('undo', context);
  assert.equal(page.values.get(field), 'see you Tuesday');
  controller.handle('undo', context);
  assert.equal(page.values.get(field), '');
  assert.match(controller.handle('undo', context).message, /Nothing to undo/);
});

test('search writes the query and submits without confirmation; other submits confirm', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const search = describe(0, page.node('Search books'), { role: 'searchbox', editable: true });
  const message = describe(1, page.node('Message'), { role: 'textbox', editable: true });
  const result = controller.handle('search for river', { elements: [message], pageSearch: search, focusedId: 1 });
  assert.equal(result.message, 'Searching for "river".');
  assert.deepEqual(page.log, [['write', 'Search books', 'river'], ['submit', 'Search books']]);
  assert.equal(controller.handle('submit', { elements: [message], focusedId: 1 }).pending.kind, 'confirm');
});

test('removed elements are not acted on', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const gone = { ...page.node('Pricing'), isConnected: false };
  assert.match(controller.handle('open pricing', { elements: [describe(1, gone)] }).message, /no longer on the page/);
  assert.equal(page.log.length, 0);
});

test('numbers without a question pick the numbered element only when asked to; confirm without a question is explained', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, page.node('Home')), describe(2, page.node('Help'))] };
  controller.handle('number 2', context);
  assert.deepEqual(page.log, [['activate', 'Help']]);
  assert.match(controller.handle('click 7', context).message, /no number 7/);
  // A number said on its own (as in conversation) never activates anything.
  assert.match(controller.handle('two', context).message, /say "click 2"/);
  assert.deepEqual(page.log, [['activate', 'Help']]);
  assert.match(controller.handle('yes', context).message, /nothing waiting/);
});

test('speech that is not understood keeps a pending confirmation or question waiting', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, page.node('Delete account'), { consequential: true }), describe(2, page.node('Read more'), { role: 'link' }), describe(3, page.node('Read more'), { role: 'link' })] };
  controller.handle('delete account', context);
  const mumble = controller.handle('mm hmm uh', context);
  assert.equal(mumble.tone, 'question');
  assert.match(mumble.message, /Still waiting: say confirm/);
  assert.equal(controller.handle('confirm', { elements: [] }).performed, 'activate');
  assert.deepEqual(page.log, [['activate', 'Delete account']]);
  controller.handle('open read more', context);
  assert.match(controller.handle('blah blah', context).message, /Still waiting: say one of 2, 3/);
  assert.equal(controller.handle('3', { elements: [] }).performed, 'activate');
});

test('tracking commands are delegated, work while paused, and clear pending questions', () => {
  const page = fakePage();
  const calls = [];
  const controller = createController({ window: {}, actions: page.actions, commands: {
    tracking: source => { calls.push(source); return { ok: true, message: `Using ${source}.` }; },
    calibrate: () => { calls.push('calibrate'); return { ok: false, message: 'Turn the camera on first.' }; },
  } });
  const context = { elements: [describe(1, page.node('Delete'), { consequential: true })] };
  controller.handle('delete', context);
  controller.handle('pause', context);
  assert.equal(controller.handle('stop camera', context).message, 'Using pointer.');
  assert.equal(controller.handle('recalibrate', context).tone, 'error');
  controller.handle('resume', context);
  assert.match(controller.handle('confirm', context).message, /nothing waiting/);
  assert.deepEqual(calls, ['pointer', 'calibrate']);
  assert.equal(page.log.length, 0);
  assert.equal(createController({ window: {}, actions: page.actions }).handle('use camera', context).tone, 'error');
});

test('a model-assisted answer follows only while it is still the latest instruction, and still confirms', async () => {
  const page = fakePage();
  let release;
  const assistant = {
    needs: (_utterance, _context, action) => action.type === 'unknown',
    improve: (_utterance, context) => new Promise(resolve => { release = () => resolve({ type: 'activate', targetId: context.elements[0].id }); }),
  };
  const controller = createController({ window: {}, actions: page.actions, assistant });
  const context = { elements: [describe(1, page.node('Reviews'), { role: 'link' }), describe(2, page.node('Place order'), { consequential: true })] };
  // The rules alone cannot name "the ratings": the controller says so and waits for the assistant.
  const first = controller.handle('show the ratings', context);
  assert.equal(first.assisting, true);
  assert.equal(page.log.length, 0);
  release();
  assert.equal((await first.followUp).performed, 'activate');
  assert.deepEqual(page.log.at(-1), ['activate', 'Reviews']);
  // A newer instruction (here cancel) makes the pending answer stale: nothing runs.
  const stale = controller.handle('show the ratings', context);
  controller.handle('cancel', { elements: [] });
  release();
  assert.equal(await stale.followUp, null);
  assert.equal(page.log.length, 1);
  // Pausing drops it as well.
  const paused = controller.handle('show the ratings', context);
  controller.handle('pause', { elements: [] });
  release();
  assert.equal(await paused.followUp, null);
  controller.handle('resume', { elements: [] });
  // Consequential picks still wait for confirmation.
  const consequential = { elements: [describe(2, page.node('Place order'), { consequential: true })] };
  const buy = controller.handle('complete my purchase', consequential);
  release();
  const asked = await buy.followUp;
  assert.equal(asked.tone, 'question');
  assert.deepEqual(asked.pending, { kind: 'confirm', candidates: null });
  assert.equal(page.log.length, 1, 'nothing ran before confirmation');
  // A failing assistant keeps the rule answer.
  const failing = createController({ window: {}, actions: page.actions, assistant: { needs: () => true, improve: () => Promise.reject(new Error('down')) } });
  assert.equal((await failing.handle('show the ratings', context).followUp).tone, 'error');
});

test('search in a non-search field requires confirmation before writing or submitting', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, page.node('Message'), { role: 'textbox', editable: true })] };
  assert.equal(controller.handle('find hello', context).pending?.kind, 'confirm');
  assert.deepEqual(page.log, []);
  assert.equal(controller.handle('confirm', context).performed, 'search');
  assert.deepEqual(page.log, [['write', 'Message', 'hello'], ['submit', 'Message']]);
});

test('confirmation refuses a target removed after the question', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const element = page.node('Delete account');
  const context = { elements: [describe(1, element, { consequential: true })] };
  controller.handle('delete account', context);
  element.isConnected = false;
  assert.match(controller.handle('confirm', context).message, /no longer on the page/);
  assert.deepEqual(page.log, []);
});


test('selection-only commands keep text history; insertion is exact and undoable', () => {
  const page = fakePage();
  const field = page.node('Message');
  let selection = { start: 5, end: 12 };
  page.actions.readSelection = () => selection;
  page.actions.selectText = (_, position) => { page.log.push(['selection', position]); return { ok: true, message: 'Selected.' }; };
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, field, { role: 'textbox', editable: true })], focusedId: 1 };
  page.values.set(field, 'Meet Tuesday at noon');
  controller.handle('select all text', context);
  assert.match(controller.handle('undo', context).message, /Nothing to undo/);
  controller.handle('replace selected text with Friday', context);
  assert.equal(page.values.get(field), 'Meet Friday at noon');
  controller.handle('undo', context);
  assert.equal(page.values.get(field), 'Meet Tuesday at noon');
  selection = { start: 5, end: 5 };
  controller.handle('insert "next " at the cursor', context);
  assert.equal(page.values.get(field), 'Meet next Tuesday at noon');
  controller.handle('pause', context);
  assert.match(controller.handle('select all text', context).message, /Paused/);
  assert.equal(page.log.filter(row => row[0] === 'selection').length, 1);
});

test('unsupported or empty selections refuse without creating an undo entry', () => {
  const page = fakePage();
  const field = page.node('Message');
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, field, { role: 'textbox', editable: true })], focusedId: 1 };
  page.values.set(field, 'Keep this');
  for (const selection of [null, { start: 3, end: 3 }]) {
    page.actions.readSelection = () => selection;
    assert.equal(controller.handle('replace selected text with lost', context).tone, 'error');
    assert.equal(page.values.get(field), 'Keep this');
    assert.match(controller.handle('undo', context).message, /Nothing to undo/);
  }
});


test('nonwritable field refusal preserves text, neighbors and existing undo history', () => {
  const page = fakePage();
  const field = page.node('Message'), neighbor = page.node('Other message');
  let writable = true;
  page.actions.canWrite = element => element !== field || writable;
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, field, { role: 'textbox', editable: true }), describe(2, neighbor, { role: 'textbox', editable: true })], focusedId: 1 };
  page.values.set(field, 'Keep Tuesday');
  page.values.set(neighbor, 'Unrelated text');
  controller.handle('type please', context);
  const count = page.log.length;
  writable = false;
  for (const said of ['type lost', 'clear it', 'replace Tuesday with Friday', 'delete last word', 'new line', 'undo']) {
    assert.match(controller.handle(said, context).message, /not writable/);
  }
  assert.equal(page.log.length, count);
  assert.equal(page.values.get(field), 'Keep Tuesday please');
  assert.equal(page.values.get(neighbor), 'Unrelated text');
  writable = true;
  controller.handle('undo', context);
  assert.equal(page.values.get(field), 'Keep Tuesday');
  assert.match(controller.handle('undo', context).message, /Nothing to undo/);
});

test('confirmed searches recheck writability before writing, history or submit', () => {
  const page = fakePage();
  const field = page.node('Message');
  let writable = true;
  page.actions.canWrite = () => writable;
  page.values.set(field, 'Keep this');
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, field, { role: 'textbox', editable: true })], focusedId: 1 };
  assert.equal(controller.handle('find replacement', context).pending.kind, 'confirm');
  writable = false;
  assert.match(controller.handle('confirm', context).message, /not writable/);
  assert.deepEqual(page.log, []);
  assert.equal(page.values.get(field), 'Keep this');
  writable = true;
  assert.match(controller.handle('undo', context).message, /Nothing to undo/);
});

test('clarified edits refuse a field locked after the question instead of using another', () => {
  const page = fakePage();
  const first = page.node('First message'), second = page.node('Second message');
  let locked = false;
  page.actions.canWrite = element => !(locked && element === second);
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, first, { role: 'textbox', editable: true, distance: 5 }), describe(2, second, { role: 'textbox', editable: true, distance: 8 })] };
  assert.equal(controller.handle('clear it', context).pending.kind, 'clarify');
  locked = true;
  assert.match(controller.handle('2', { elements: [] }).message, /not writable/);
  assert.deepEqual(page.log, []);
});

test('checkbox state keeps consequential clarification and cancellation before execution', () => {
  const page=fakePage();page.actions.setChecked=(element,checked)=>{page.log.push(['check',element.name,checked]);return{ok:true,message:'state set'};};
  const controller=createController({window:{},actions:page.actions});
  const context={elements:[describe(1,page.node('Agree'),{role:'checkbox',consequential:true}),describe(2,page.node('Agree'),{role:'checkbox',consequential:true})]};
  assert.equal(controller.handle('check Agree',context).pending.kind,'clarify');
  assert.equal(controller.handle('two',context).pending.kind,'confirm');assert.deepEqual(page.log,[]);
  controller.handle('cancel',context);controller.handle('confirm',context);assert.deepEqual(page.log,[]);
  controller.handle('uncheck Agree',context);controller.handle('two',context);assert.equal(controller.handle('confirm',context).performed,'check');
  assert.deepEqual(page.log,[['check','Agree',false]]);
});

test('custom state acknowledgment is reported only for the current instruction',async()=>{
 for(const next of [null,'cancel','pause','open Help']){
  const page=fakePage();let finish;page.actions.setChecked=()=>({message:'Checking requested state…',followUp:new Promise(resolve=>{finish=resolve;})});
  const c=createController({window:{},actions:page.actions}),context={elements:[describe(1,page.node('Newsletter'),{role:'switch'}),describe(2,page.node('Help'))]};
  const r=c.handle('check Newsletter',context);assert.equal(r.performed,null);assert.equal(typeof r.followUp?.then,'function');
  if(next)c.handle(next,context);finish({ok:true,message:'Switch checked.'});
  const done=await r.followUp;if(next)assert.equal(done,null);else{assert.equal(done.tone,'success');assert.equal(done.performed,'check');}
 }
});

test('failed custom acknowledgment is handled without an unhandled rejection',async()=>{
 const page=fakePage();page.actions.setChecked=()=>({message:'Checking state…',followUp:Promise.reject(new Error('site callback failed'))});
 const c=createController({window:{},actions:page.actions});
 const r=c.handle('check Newsletter',{elements:[describe(1,page.node('Newsletter'),{role:'checkbox'})]});
 assert.equal(typeof r.followUp?.then,'function');assert.equal((await r.followUp).tone,'error');
});

for (const cancel of [false, true]) test(`assisted check awaits final website state${cancel ? ' and retires cancelled feedback' : ''}`, async () => {
 const {createAssistedInterpreter}=await import('../src/web/assisted-interpreter.js');
 const page=fakePage();let finish, started;
 const began=new Promise(resolve=>{started=resolve;});
 page.actions.setChecked=()=>{started();return {message:'Checking…',followUp:new Promise(resolve=>{finish=resolve;})};};
 const assistant=createAssistedInterpreter({model:{decide:async()=>({probs:[.91,.04,.05]})}});
 const c=createController({window:{},actions:page.actions,assistant});
 const context={elements:['Newsletter weekly','Newsletter monthly'].map((name,i)=>describe(i+1,page.node(name),{role:'switch',checked:false}))};
 const first=c.handle('check Newsletter',context);await began;
 if(cancel)c.handle('cancel',context);
 finish({ok:true,message:'Switch checked.'});
 const done=await first.followUp;
 if(cancel)assert.equal(done,null);else{assert.equal(done.message,'Switch checked.');assert.equal(done.performed,'check');assert.equal(done.followUp,undefined);}
});

test('dropdown clarification forwards the original native option snapshot to execution', () => {
  const page = fakePage(), snapshots = [{ options: ['first'] }, { options: ['second'] }];
  const seen = [];
  page.actions.selectOption = (element, index, snapshot) => { seen.push([element, index, snapshot]); return { ok: true, message: 'selected' }; };
  const controller = createController({ window: {}, actions: page.actions });
  const nodes = [page.node('Format'), page.node('Format')];
  const context = { elements: nodes.map((element, i) => describe(i + 1, element, { role: 'combobox', options: ['Paperback', 'Hardcover'], selectSnapshot: snapshots[i] })) };
  assert.equal(controller.handle('choose Hardcover from Format', context).pending.kind, 'clarify');
  assert.equal(controller.handle('two', { elements: [] }).performed, 'select-option');
  assert.equal(seen.length, 1); assert.equal(seen[0][0], nodes[1]); assert.equal(seen[0][1], 1); assert.equal(seen[0][2], snapshots[1]);
});

test('a consequential dropdown choice waits for deliberate confirmation', () => {
  const page = fakePage(), controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, page.node('Action'), { role: 'combobox', options: ['Keep', 'Delete account'], consequentialOptions: [false, true] })] };
  const waiting = controller.handle('choose Delete account from Action', context);
  assert.equal(waiting.pending?.kind, 'confirm'); assert.match(waiting.message, /Delete account/); assert.match(waiting.message, /Action/);
  assert.deepEqual(page.log, []); controller.handle('cancel', context); controller.handle('confirm', context); assert.deepEqual(page.log, []);
  controller.handle('choose Delete account from Action', context); assert.equal(controller.handle('confirm', { elements: [] }).performed, 'select-option');
  assert.deepEqual(page.log, [['option', 1]]);
});

test('edits to sensitive fields never echo their text', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const field = page.node('Password');
  const context = { elements: [describe(1, field, { role: 'textbox', editable: true, sensitive: true, value: '' })] };
  const typed = controller.handle('type hunter2', context);
  assert.equal(typed.tone, 'success');
  assert.doesNotMatch(typed.message, /hunter2/);
  assert.match(typed.message, /hidden/);
  assert.deepEqual(page.log.at(-1), ['write', 'Password', 'hunter2'], 'the text is still written');
  assert.doesNotMatch(controller.handle('undo', context).message, /hunter2/);
});

test('controls with hard-to-undo or outward effects are consequential', async () => {
  const { isConsequentialName } = await import('../src/web/page-context.js');
  for (const name of ['Reply all', 'Forward', 'Archive', 'Book now', 'Upload photo', 'Share', 'Accept invitation', 'Cancel order', 'Discard draft', 'Delete'])
    assert.ok(isConsequentialName(name), name);
  for (const name of ['Home', 'Read more', 'Cancel', 'Next', 'Show replies', 'Search']) assert.ok(!isConsequentialName(name), name);
});

test('a control named inside the circle and used is reported as where the user aimed', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const pricing = describe(1, page.node('Pricing'), { role: 'link' });
  const context = { elements: [pricing], nearby: [describe(101, page.node('Careers'), { role: 'link' })], region: 'page', x: 10, y: 10 };
  assert.equal(controller.handle('open pricing', context).aimed, pricing);
  // Just outside the circle, or not a pointing action, says nothing about where the user looked.
  const outside = controller.handle('open careers', context);
  assert.equal(outside.performed, 'activate');
  assert.equal(outside.aimed, null);
  assert.equal(controller.handle('scroll down', context).aimed, null);
});

test('unavailable tracking refuses page actions and retires an earlier confirmation',()=>{
  const page=fakePage(),controller=createController({window:{},actions:page.actions});
  const context={elements:[describe(1,page.node('Pricing')),describe(2,page.node('Delete account'),{consequential:true})],region:'page'};
  controller.handle('delete account',context);assert.equal(controller.pending.kind,'confirm');
  const lost={...context,trackingUnavailable:true};
  for(const command of ['confirm','open pricing','scroll down','go back']) {
    const result=controller.handle(command,lost);assert.equal(result.performed,undefined);assert.match(result.message,/tracking.*lost|fresh.*gaze/i);assert.equal(controller.pending,null);
  }
  assert.deepEqual(page.log,[]);
  assert.equal(controller.handle('open pricing',context).performed,'activate');
});

test('unavailable tracking leaves safety and tracking recovery commands usable',()=>{
  const calls=[],controller=createController({window:{},commands:{tracking:source=>{calls.push(source);return {ok:true,message:source};},calibrate:()=>({ok:true,message:'Calibrating'}),circleSize:size=>({ok:true,message:size})}}),lost={elements:[],trackingUnavailable:true};
  assert.equal(controller.handle('pause',lost).paused,true);assert.equal(controller.handle('cancel',lost).cancelled,true);
  assert.equal(controller.handle('use pointer',lost).tone,'success');assert.deepEqual(calls,['pointer']);
  assert.equal(controller.handle('recalibrate',lost).tone,'success');assert.equal(controller.handle('use a large circle',lost).tone,'success');assert.equal(controller.handle('resume',lost).paused,false);
});

test('unready calibration explains how to recover without changing the page', () => {
  const page = fakePage(), controller = createController({ window: {}, actions: page.actions });
  const result = controller.handle('open pricing', { elements: [describe(1, page.node('Pricing'))], trackingUnavailable: 'calibration' });
  assert.equal(result.performed, undefined); assert.deepEqual(page.log, []);
  assert.match(result.message, /calibration.*not ready/i); assert.match(result.message, /recalibrate.*use pointer/i);
});
