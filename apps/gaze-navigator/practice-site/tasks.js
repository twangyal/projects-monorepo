// Guided practice tasks: a short run of everyday tasks on this site, timed and checked from the page itself. Each
// task counts the instructions the navigator answered while it was current (acted, asked, did nothing), and the
// actions nobody asked for: pages away from the task, orders, messages, removals and other books added to the cart.
// The run lives in this tab's session storage; its report is only downloaded when you choose.
export const TASKS = [
  { id: 'catalog', text: 'Open the Catalog.', pages: ['index', 'catalog'], done: ({ page }) => page === 'catalog' },
  { id: 'sort', text: 'Sort the catalog by price, low to high.', pages: ['catalog'],
    done: ({ page, document }) => page === 'catalog' && document.querySelector('#sort')?.value === 'Price, low to high' },
  { id: 'search', text: 'Search the site for “river”.', pages: ['catalog', 'search', 'index'],
    done: ({ page, location }) => page === 'search' && /river/i.test(new URLSearchParams(location.search).get('q') ?? '') },
  { id: 'format', text: 'Open The Quiet River and choose the Hardcover format.', pages: ['search', 'catalog', 'index', 'book'],
    done: ({ page, document }) => page === 'book' && document.querySelector('select[name=format]')?.value === 'Hardcover' },
  { id: 'note', text: 'Write the gift note “Happy birthday”.', pages: ['book'],
    done: ({ page, document }) => page === 'book' && /^\s*happy birthday[.!]?\s*$/i.test(document.querySelector('input[name=note]')?.value ?? '') },
  { id: 'cart', text: 'Add The Quiet River to your cart.', pages: ['book'], done: ({ event }) => event?.kind === 'cart' && event.title === 'The Quiet River' },
  { id: 'reviews', text: 'Scroll the reader reviews to the end.', pages: ['book'],
    done: ({ page, document }) => { const reviews = page === 'book' && document.querySelector('.reviews'); return Boolean(reviews) && reviews.scrollTop + reviews.clientHeight >= reviews.scrollHeight - 4; } },
  { id: 'contact', text: 'Go to Contact and choose the topic “Order problem”.', pages: ['book', 'contact'],
    done: ({ page, document }) => page === 'contact' && document.querySelector('#topic')?.value === 'Order problem' },
];
const KEY = 'northwind-practice-run', CREDIT_MS = 1000;

export function newRun(now) {
  return { version: 1, startedAt: now, finishedAt: null, current: 0, tasks: TASKS.map(task => ({ id: task.id, text: task.text, startedAt: null, seconds: null, outcome: null,
    instructions: 0, acted: 0, asked: 0, cancelled: 0, failed: 0, unintended: 0, events: [] })) };
}

/** The report a finished or stopped run downloads: per task and in total. */
export function report(run) {
  const tasks = run.tasks.map(({ id, text, outcome, seconds, instructions, acted, asked, cancelled, failed, unintended, events }) => ({ id, text, outcome: outcome ?? 'not reached', seconds, instructions, acted, asked, cancelled, failed, unintended, events }));
  const sum = key => tasks.reduce((total, task) => total + task[key], 0);
  return {
    kind: 'gaze-navigator-practice-report', version: 1, startedAt: new Date(run.startedAt).toISOString(), finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
    completed: tasks.filter(task => task.outcome === 'completed').length, tasks: tasks.length,
    completedWithoutUnintended: tasks.filter(task => task.outcome === 'completed' && !task.unintended).length,
    instructions: sum('instructions'), asked: sum('asked'), failed: sum('failed'), unintended: sum('unintended'),
    seconds: Math.round(tasks.reduce((total, task) => total + (task.seconds ?? 0), 0) * 10) / 10,
    details: tasks,
  };
}

/** Records one thing that happened on the page or in the navigator against the current task; returns whether the task is now done. */
export function record(run, happening, state, now) {
  const index = run.current, task = run.tasks[index], spec = TASKS[index];
  if (!task || run.finishedAt) return false;
  task.startedAt ??= now;
  const note = text => noteOn(task, text, now);
  if (happening.kind === 'instruction') {
    countInstruction(task, happening, now);
  } else if (happening.kind === 'page' && !spec.pages.includes(happening.page)) {
    task.unintended++; note(`opened ${happening.page}`);
  } else if (happening.kind === 'cart' && !(spec.id === 'cart' && happening.title === 'The Quiet River')) {
    task.unintended++; note(`added ${happening.title} to the cart`);
  } else if (happening.kind === 'consequential') {
    task.unintended++; note(happening.text);
  }
  if (!spec.done({ ...state, event: happening })) return false;
  finish(run, 'completed', now);
  return true;
}

function noteOn(task, text, now) {
  if (task.events.length < 40) task.events.push({ at: Math.round((now - (task.startedAt ?? now)) / 100) / 10, text });
}
/** Counts an instruction's answer against a task (also one that the instruction itself just completed). */
export function countInstruction(task, { utterance, via, outcome }, now) {
  task.instructions++;
  if (['acted', 'asked', 'cancelled', 'failed'].includes(outcome)) task[outcome]++;
  noteOn(task, `${via}: “${String(utterance).slice(0, 120)}” → ${outcome}`, now);
}

export function finish(run, outcome, now) {
  const task = run.tasks[run.current];
  if (!task) return;
  task.startedAt ??= now;
  task.outcome = outcome; task.seconds = Math.round((now - task.startedAt) / 100) / 10;
  run.current++;
  if (run.current < run.tasks.length) run.tasks[run.current].startedAt = now;
  else run.finishedAt = now;
}

/** Ends a run early: the current task is stopped and the rest are not reached. */
export function stop(run, now) {
  const index = run.current;
  if (index >= run.tasks.length) return;
  finish(run, 'stopped', now);
  for (const task of run.tasks.slice(index + 1)) { task.startedAt = null; task.outcome = 'not reached'; }
  run.current = run.tasks.length; run.finishedAt = now;
}

export function mountPracticeTasks({ window = globalThis.window, document = window.document, now = () => Date.now() } = {}) {
  const storage = (() => { try { return window.sessionStorage; } catch { return null; } })();
  const load = () => { try { const value = JSON.parse(storage?.getItem(KEY) ?? 'null'); return value?.version === 1 ? value : null; } catch { return null; } };
  const save = () => { try { if (run) storage?.setItem(KEY, JSON.stringify(run)); else storage?.removeItem(KEY); } catch { /* The run lasts for this page. */ } };
  const page = (window.location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
  let run = load();
  const main = document.querySelector('main');
  if (!main) return null;
  const box = document.createElement('section');
  box.className = 'practice-tasks';
  box.setAttribute('aria-label', 'Practice tasks');
  main.prepend(box);
  const state = () => ({ page, document, location: window.location });

  function render() {
    if (!run) {
      // The invitation is on the home page; other pages stay as they are.
      box.hidden = page !== 'index';
      box.innerHTML = `<h2>Practice tasks</h2><p>Eight everyday tasks on this site, using your gaze and voice (or the pointer and typing). The page checks each one and notes how many instructions it took and anything done by mistake. Nothing leaves this tab unless you download the report.</p><button type="button" data-practice-start>Start practice tasks</button>`;
      return;
    }
    box.hidden = false;
    if (run.finishedAt) {
      const summary = report(run);
      box.innerHTML = `<h2>Practice tasks finished</h2><p role="status">${summary.completed} of ${summary.tasks} tasks completed, ${summary.completedWithoutUnintended} with nothing done by mistake. ${summary.instructions} instructions, ${summary.asked} questions from the navigator, ${summary.failed} not understood or refused, ${summary.unintended} unintended actions, ${summary.seconds} seconds.</p>
        <table><thead><tr><th>Task</th><th>Result</th><th>Seconds</th><th>Instructions</th><th>Unintended</th></tr></thead><tbody>${summary.details.map(task => `<tr><td></td><td>${task.outcome}</td><td>${task.seconds ?? ''}</td><td>${task.instructions}</td><td>${task.unintended}</td></tr>`).join('')}</tbody></table>
        <button type="button" data-practice-download>Download report</button> <button type="button" data-practice-again>Start again</button> <button type="button" data-practice-close>Close</button>`;
      box.querySelectorAll('tbody tr td:first-child').forEach((cell, index) => { cell.textContent = summary.details[index].text; });
      return;
    }
    const task = run.tasks[run.current];
    box.innerHTML = `<h2>Practice task ${run.current + 1} of ${run.tasks.length}</h2><p role="status" class="practice-task"></p><button type="button" data-practice-skip>Skip task</button> <button type="button" data-practice-stop>Stop practice</button>`;
    box.querySelector('.practice-task').textContent = task.text;
  }

  // A task that an instruction completes is done before the navigator answers: the next answer, within a second,
  // belongs to that task.
  let credit = null;
  function happen(happening) {
    if (!run) return;
    if (happening.kind === 'instruction' && credit && now() - credit.at <= CREDIT_MS) { countInstruction(run.tasks[credit.index], happening, now()); credit = null; save(); return; }
    if (happening.kind === 'instruction') credit = null;
    if (run.finishedAt) return;
    const index = run.current, done = record(run, happening, state(), now());
    // (A page that loads has already had its instruction counted on the page before.)
    if (done && !['instruction', 'page'].includes(happening.kind)) credit = { index, at: now() };
    save();
    if (done) render();
  }
  // The instruction that pressed one of these buttons belongs to no task.
  let quiet = false;
  box.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    quiet = true; window.setTimeout(() => { quiet = false; }, 0);
    if (button.matches('[data-practice-start], [data-practice-again]')) { run = newRun(now()); run.tasks[0].startedAt = now(); save(); render(); happen({ kind: 'check' }); return; }
    if (button.matches('[data-practice-skip]')) { finish(run, 'skipped', now()); save(); render(); happen({ kind: 'check' }); return; }
    if (button.matches('[data-practice-stop]')) { stop(run, now()); save(); render(); return; }
    if (button.matches('[data-practice-close]')) { run = null; save(); render(); return; }
    if (button.matches('[data-practice-download]')) {
      const url = URL.createObjectURL(new window.Blob([JSON.stringify(report(run), null, 2)], { type: 'application/json' }));
      const link = Object.assign(document.createElement('a'), { href: url, download: 'gaze-practice-report.json' });
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  // The page itself: the controls the tasks are about, and actions with consequences.
  document.addEventListener('click', event => {
    if (event.target.closest?.('.practice-tasks')) return;
    const cart = event.target.closest?.('.add-to-cart');
    if (cart) { happen({ kind: 'cart', title: cart.dataset.title }); return; }
    const practice = event.target.closest?.('button[data-practice]');
    if (practice) happen({ kind: 'consequential', text: `pressed ${practice.textContent.trim()}` });
  });
  document.addEventListener('submit', event => {
    if (event.target.matches?.('form[data-practice]')) happen({ kind: 'consequential', text: `submitted ${event.submitter?.textContent.trim() || 'a form'}` });
  });
  for (const type of ['change', 'input']) document.addEventListener(type, () => happen({ kind: 'check' }));
  document.addEventListener('scroll', () => happen({ kind: 'check' }), true);
  window.addEventListener('gaze-navigator:result', event => { if (!quiet) happen({ kind: 'instruction', ...event.detail }); });
  render();
  if (run && !run.finishedAt) happen({ kind: 'page', page });
  return { get run() { return run; } };
}

if (typeof window !== 'undefined' && window.document) mountPracticeTasks();
