'use strict';
// The capability never enters a request URL, DOM text, storage, or a log.
const launch = new URLSearchParams(location.hash.slice(1));
let capability = launch.getAll('session').length === 1 ? launch.get('session') : null;
history.replaceState(null, '', location.pathname + location.search);
if (!/^[a-f0-9]{64}$/.test(capability || '')) capability = null;

const $ = id => document.getElementById(id);
const utf8 = new TextEncoder();
const PAGE = 50;
let ready = false, generation = 0, desired = null, pumping = false, active = null, uncertainJob = false;
let snapshot = null, source = null, files = [], functions = [], functionCounts = new Map();
let filePage = 0, sourcePage = 0, functionPage = 0, selectedFunction = null;
let context = null, contextName = '', contextGeneration = 0, contextLoading = false;
let reportIdentity = null, htmlUrl = null, jsonUrl = null, connecting = false;
const visible = text => JSON.stringify(text).slice(1, -1);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function error(text) { $('error').textContent = text; $('error').hidden = !text; }
function status(text) { $('status').textContent = text; }
function expire() {
  ready = false; capability = null; generation++; desired = null; revokeDownloads();
  error('This session is missing or expired. Reopen the original URL printed by git-history serve in your terminal. Reloading this page does not retain access.');
  status('Local session unavailable.'); controls();
}
async function api(path, body) {
  if (!capability) throw new Error('Reopen the original terminal URL to start a local session.');
  let response;
  try {
    response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Git-History-Token': capability }, body: JSON.stringify(body), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch { throw new Error('Could not reach the local service. Keep this page open and check the terminal.'); }
  let value;
  try { value = await response.json(); } catch { throw new Error('The local service returned an unreadable response.'); }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) expire();
    const failure = new Error(typeof value.error === 'string' ? value.error : 'The local service rejected this request.');
    failure.httpStatus = response.status;
    throw failure;
  }
  return value;
}
function controls() {
  const unavailable = !ready || uncertainJob;
  $('discover-button').disabled = unavailable;
  $('open-source').disabled = unavailable || !snapshot;
  $('functions-button').disabled = unavailable || !source;
  $('generate-report').disabled = unavailable || !source || source.line_count < 1 || contextLoading;
  $('stop-button').disabled = !pumping && !desired;
  $('start-line').disabled = $('selection-mode').value === 'function';
  $('end-line').disabled = $('selection-mode').value === 'function';
}
function revokeDownloads() {
  if (htmlUrl) URL.revokeObjectURL(htmlUrl);
  if (jsonUrl) URL.revokeObjectURL(jsonUrl);
  htmlUrl = null; jsonUrl = null;
  for (const id of ['download-html', 'download-json']) { $(id).removeAttribute('href'); $(id).setAttribute('aria-disabled', 'true'); }
  if (reportIdentity) $('report-stale').hidden = false;
}
function invalidate() { generation++; desired = null; revokeDownloads(); controls(); }
function clearFunctions() {
  functions = []; functionCounts = new Map(); functionPage = 0; selectedFunction = null;
  $('selection-mode').value = 'lines'; $('selection-mode').options[1].disabled = true;
  $('selected-function').textContent = 'No named function selected';
  $('function-status').textContent = 'Manual ranges work without an optional language parser.';
  renderFunctions();
}
function clearSource() {
  source = null; sourcePage = 0; $('selected-path').textContent = 'No source loaded'; clearFunctions(); renderSource(); controls();
}
function discoveryChanged() {
  invalidate(); snapshot = null; files = []; filePage = 0; clearSource();
  $('revision').textContent = 'Discover this ref to resolve its commit';
  $('catalog-summary').textContent = 'Discovery controls changed. Discover again before opening a file.';
  renderFiles(); controls();
}
function pathChanged() { invalidate(); clearSource(); }
function exactText(value, label) {
  if (!value.startsWith('"')) return value;
  let decoded;
  try { decoded = JSON.parse(value); } catch { throw new Error(`${label} has an invalid JSON-quoted value. Your input is kept.`); }
  if (typeof decoded !== 'string') throw new Error(`${label} must be a text path.`);
  return decoded;
}
function boundedText(text, bytes, label, empty = false) {
  if ((!empty && !text) || text.includes('\0') || utf8.encode(text).length > bytes) throw new Error(`${label} must be ${empty ? 'at most' : 'nonempty and at most'} ${bytes} UTF-8 bytes, without NUL characters.`);
  return text;
}
function queueJob(operation, args, receive, label) {
  if (!ready || uncertainJob) return;
  generation++; revokeDownloads(); error('');
  desired = { generation, operation, args, receive, label };
  status(active ? 'Stopping previous work; the replacement waits for cleanup…' : label);
  controls(); void pump();
}
async function pump() {
  if (pumping) return;
  pumping = true; controls();
  try {
    while (desired && ready && !uncertainJob) {
      const task = desired; desired = null;
      let accepted;
      try { accepted = await api('/api/jobs', { operation: task.operation, args: task.args }); }
      catch (failure) {
        if (!failure.httpStatus) { uncertainJob = true; error('The job-start response was lost. Its cleanup cannot be confirmed here. Check the terminal and reopen its original URL before starting more work.'); }
        else if (task.generation === generation) error(failure.message);
        if (task.generation === generation) status('Request was not completed. Your drafts are kept.');
        continue;
      }
      active = { id: accepted.id, cancellationSent: false }; controls();
      let terminal = null;
      while (ready && !terminal) {
        try {
          if (task.generation !== generation && !active.cancellationSent) {
            const cancellation = await api('/api/cancel', { id: active.id });
            active.cancellationSent = true;
            status(cancellation.state === 'cancelling' ? 'Stopping work and waiting for subprocess cleanup…' : 'Checking completed cleanup…');
          }
          const value = await api('/api/result', { id: active.id });
          if (value.state === 'pending') { await sleep(150); continue; }
          terminal = value;
        } catch (failure) {
          if (!ready) break;
          if (failure.httpStatus === 404) { terminal = { state: 'error', error: 'The job result expired. Run the selection again.' }; break; }
          error(failure.message); status('Waiting to confirm job cleanup. Replacement work has not started.');
          await sleep(750);
        }
      }
      active = null;
      if (terminal && task.generation === generation) {
        if (terminal.state === 'complete') {
          try { task.receive(terminal.result); error(''); status(`${task.label} Complete.`); }
          catch { error('The completed result could not be displayed. Your drafts and previous report are kept.'); }
        } else { error(terminal.error || 'Work was cancelled. Your drafts are kept.'); status('No new result was published.'); }
      } else if (!desired && ready) status('Previous work stopped or superseded; cleanup is complete.');
      controls();
    }
  } finally { pumping = false; controls(); }
}
$('stop-button').addEventListener('click', () => { invalidate(); status(pumping ? 'Stopping work and waiting for cleanup…' : 'Stopped.'); });
function pager(prefix, page, count, size, noun) {
  $(prefix + '-prev').disabled = page === 0;
  $(prefix + '-next').disabled = (page + 1) * size >= count;
  $(prefix + '-page').textContent = count ? `${page * size + 1}–${Math.min((page + 1) * size, count)} of ${count} ${noun}` : `0 ${noun}`;
}
function renderFiles() {
  const list = $('file-list'); list.replaceChildren();
  const query = $('file-filter').value.toLocaleLowerCase();
  const matches = files.filter(file => file.path.toLocaleLowerCase().includes(query));
  for (const file of matches.slice(filePage * PAGE, (filePage + 1) * PAGE)) {
    const item = node('li'), choice = node('button'); choice.type = 'button';
    choice.append(node('span', visible(file.path), 'file-path'), node('small', `${file.language} · ${file.size_bytes} bytes`));
    choice.addEventListener('click', () => { $('path').value = JSON.stringify(file.path); pathChanged(); openSource(); });
    item.append(choice); list.append(item);
  }
  pager('file', filePage, matches.length, PAGE, 'matches');
  $('file-page').textContent += ` · ${files.length} total files`;
}
function renderSource() {
  const body = $('source-lines').tBodies[0]; body.replaceChildren();
  if (!source) { $('source-caption').textContent = 'No source loaded'; pager('source', 0, 0, 100, 'lines'); return; }
  $('source-caption').textContent = `${visible(source.path)} · ${source.line_count} physical lines · committed source`;
  const first = sourcePage * 100;
  for (let i = first; i < Math.min(first + 100, source.lines.length); i++) {
    const row = node('tr'), number = node('th'), choose = node('button', String(i + 1)); number.scope = 'row'; choose.type = 'button'; choose.setAttribute('aria-label', `Select line ${i + 1}`);
    choose.addEventListener('click', event => {
      const start = Number($('start-line').value);
      if (event.shiftKey && Number.isInteger(start) && start > 0 && start <= i + 1) $('end-line').value = String(i + 1);
      else { $('start-line').value = String(i + 1); $('end-line').value = String(i + 1); }
      $('selection-mode').value = 'lines'; invalidate(); controls();
    });
    number.append(choose); const text = node('td'); text.append(node('pre', source.lines[i] || ' ')); row.append(number, text); body.append(row);
  }
  pager('source', sourcePage, source.lines.length, 100, 'lines');
}
function renderFunctions() {
  const list = $('function-list'); list.replaceChildren();
  const query = $('function-filter').value.toLocaleLowerCase();
  const matches = functions.filter(fn => fn.qualified_name.toLocaleLowerCase().includes(query));
  for (const fn of matches.slice(functionPage * PAGE, (functionPage + 1) * PAGE)) {
    const item = node('li'), title = node('p', visible(fn.qualified_name).slice(0, 180) + (fn.qualified_name.length > 180 ? '…' : ''));
    const length = fn.end_line - fn.start_line + 1;
    const eligible = length <= 200 && functionCounts.get(fn.qualified_name) === 1 && utf8.encode(fn.qualified_name).length <= 8192;
    item.append(title, node('small', `${fn.kind} · lines ${fn.start_line}:${fn.end_line} · ${length} lines`));
    const choice = node('button', eligible ? 'Select function' : 'Use manual range'); choice.type = 'button';
    choice.addEventListener('click', () => {
      invalidate(); $('start-line').value = String(fn.start_line); $('end-line').value = String(fn.end_line);
      if (eligible) { selectedFunction = fn.qualified_name; $('selection-mode').options[1].disabled = false; $('selection-mode').value = 'function'; $('selected-function').textContent = `Selected function: ${visible(fn.qualified_name)}`; }
      else { $('selection-mode').value = 'lines'; status(length > 200 ? 'This function is longer than 200 lines. Narrow its manual range before reporting.' : 'Use the displayed manual range for this ambiguous or very long function name.'); }
      sourcePage = Math.floor((fn.start_line - 1) / 100); renderSource(); controls();
    });
    item.append(choice); list.append(item);
  }
  pager('function', functionPage, matches.length, PAGE, 'matches');
  $('function-page').textContent += ` · ${functions.length} total functions`;
}
for (const [prefix, change, render] of [['file', n => { filePage += n; }, renderFiles], ['source', n => { sourcePage += n; }, renderSource], ['function', n => { functionPage += n; }, renderFunctions]]) {
  $(prefix + '-prev').addEventListener('click', () => { change(-1); render(); });
  $(prefix + '-next').addEventListener('click', () => { change(1); render(); });
}
$('file-filter').addEventListener('input', () => { filePage = 0; renderFiles(); });
$('function-filter').addEventListener('input', () => { functionPage = 0; renderFunctions(); });
for (const id of ['ref', 'directory']) $(id).addEventListener('input', discoveryChanged);
$('language').addEventListener('change', discoveryChanged);
$('path').addEventListener('input', pathChanged);
for (const id of ['start-line', 'end-line', 'max-commits']) $(id).addEventListener('input', invalidate);
$('selection-mode').addEventListener('change', () => { invalidate(); controls(); });
$('discovery-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const args = { ref: boundedText($('ref').value, 1024, 'Ref'), directory: boundedText(exactText($('directory').value, 'Directory'), 4096, 'Directory', true), language: $('language').value };
    queueJob('files', args, catalog => {
      snapshot = { revision: catalog.revision, requested_ref: catalog.requested_ref }; clearSource(); files = catalog.files; filePage = 0;
      $('revision').textContent = catalog.revision;
      $('catalog-summary').textContent = `${files.length} committed candidates · ${catalog.omitted_non_utf8_paths || 0} non-UTF-8 paths omitted. Discovery and all subsequent reads use this exact commit.`;
      renderFiles(); controls();
    }, 'Discovering committed files.');
  } catch (failure) { error(failure.message); }
});
function openSource() {
  if (!snapshot) { error('Discover a revision before opening a path.'); return; }
  try {
    const args = { revision: snapshot.revision, path: boundedText(exactText($('path').value, 'Path'), 4096, 'Path') };
    queueJob('source', args, result => {
      const lines = result.source === '' ? [] : result.source.split('\n'); if (result.source.endsWith('\n')) lines.pop();
      source = { ...result, lines }; sourcePage = 0; clearFunctions(); $('selected-path').textContent = visible(result.path); renderSource(); controls();
    }, 'Reading committed source.');
  } catch (failure) { error(failure.message); }
}
$('source-form').addEventListener('submit', event => { event.preventDefault(); openSource(); });
$('functions-button').addEventListener('click', () => {
  if (!source) return;
  queueJob('functions', { revision: source.revision, path: source.path }, catalog => {
    functions = catalog.functions; functionPage = 0; functionCounts = new Map();
    for (const fn of functions) functionCounts.set(fn.qualified_name, (functionCounts.get(fn.qualified_name) || 0) + 1);
    $('function-status').textContent = `${functions.length} committed definitions. Long, ambiguous or oversized names use manual ranges.`; renderFunctions();
  }, 'Discovering committed functions.');
});
$('context-file').addEventListener('change', async () => {
  const file = $('context-file').files[0]; $('context-file').value = ''; if (!file) return;
  const attempt = ++contextGeneration; contextLoading = true; invalidate(); controls();
  $('context-status').textContent = 'Reading supplied JSON; existing context is kept until this read succeeds…';
  try {
    if (file.size > 256 * 1024) throw new Error('Supplied context exceeds 256 KiB. Existing context was kept.');
    const bytes = await file.arrayBuffer(); const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (attempt !== contextGeneration) return;
    context = text; contextName = file.name; error('');
  } catch (failure) { if (attempt === contextGeneration) error(failure instanceof TypeError ? 'Context must be valid UTF-8. Existing context was kept.' : failure.message); }
  finally {
    if (attempt === contextGeneration) { contextLoading = false; $('context-status').textContent = context === null ? 'No supplied context' : `${visible(contextName)} · supplied and unverified · checked against the report when generated`; controls(); }
  }
});
$('context-clear').addEventListener('click', () => { contextGeneration++; contextLoading = false; context = null; contextName = ''; invalidate(); $('context-status').textContent = 'No supplied context'; controls(); });
function integer(input, min, max, label) {
  if (!/^[0-9]+$/.test(input) || !Number.isSafeInteger(Number(input)) || Number(input) < min || Number(input) > max) throw new Error(`${label} must be an integer from ${min} to ${max}. Your input is kept.`);
  return Number(input);
}
$('report-form').addEventListener('submit', event => {
  event.preventDefault(); if (!source || contextLoading) return;
  try {
    let selection;
    if ($('selection-mode').value === 'function') {
      if (!selectedFunction) throw new Error('Choose a function or use a manual range.'); selection = { function: selectedFunction };
    } else {
      const start = integer($('start-line').value, 1, source.line_count, 'Start line');
      const end = integer($('end-line').value, start, source.line_count, 'End line');
      if (end - start + 1 > 200) throw new Error('Select at most 200 lines. Your range is kept.'); selection = { start, end };
    }
    const args = { revision: source.revision, path: source.path, selection, max_commits: integer($('max-commits').value, 1, 50, 'Maximum commits'), context };
    const identity = `${visible(source.path)} · ${source.revision} · ${selection.function ? 'function ' + visible(selection.function) : 'lines ' + selection.start + ':' + selection.end} · up to ${args.max_commits} commits · ${context === null ? 'no supplied context' : 'unverified context: ' + visible(contextName)}`;
    queueJob('report', args, result => {
      revokeDownloads(); reportIdentity = identity;
      // srcdoc resolves relative anchors against the workbench URL. Give only
      // preview anchors an explicit same-document destination; downloads retain
      // the renderer's original bytes. The parsed document is never installed
      // in the parent, and the preview remains a script-free opaque sandbox.
      const preview = new DOMParser().parseFromString(result.html, 'text/html');
      for (const anchor of preview.querySelectorAll('a[href^="#"]')) {
        anchor.setAttribute('href', 'about:srcdoc' + anchor.getAttribute('href'));
      }
      $('report-frame').srcdoc = '<!doctype html>' + preview.documentElement.outerHTML;
      $('report-frame').hidden = false; $('report-empty').hidden = true;
      $('report-description').textContent = identity; $('report-stale').hidden = true;
      htmlUrl = URL.createObjectURL(new Blob([result.html], { type: 'text/html;charset=utf-8' }));
      jsonUrl = URL.createObjectURL(new Blob([result.json], { type: 'application/json;charset=utf-8' }));
      for (const [id, href, filename] of [['download-html', htmlUrl, 'git-history-report.html'], ['download-json', jsonUrl, 'git-history-report.json']]) { $(id).href = href; $(id).download = filename; $(id).setAttribute('aria-disabled', 'false'); }
    }, 'Collecting Git evidence.');
  } catch (failure) { error(failure.message); }
});
window.addEventListener('pagehide', () => {
  generation++; desired = null; ready = false; revokeDownloads();
  if (active && capability) void fetch('/api/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Git-History-Token': capability }, body: JSON.stringify({ id: active.id }), credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true }).catch(() => {});
  capability = null;
});
window.addEventListener('pageshow', event => { if (event.persisted) expire(); });
for (const id of ['download-html', 'download-json']) $(id).addEventListener('click', event => { if ($(id).getAttribute('aria-disabled') === 'true') event.preventDefault(); });
async function connectSession() {
  controls();
  if (!capability) { expire(); return; }
  connecting = true;
  try {
    const session = await api('/api/session', {});
    ready = true; $('repo-name').textContent = session.repo_name; error('');
    status('Ready. Discover a ref to inspect its committed files.'); controls();
  } catch (failure) {
    if (capability) { error(failure.message); status('Reopen the terminal URL after checking the service.'); }
  } finally { connecting = false; }
}
window.addEventListener('hashchange', () => {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (!fragment.has('session')) return;
  const token = fragment.getAll('session').length === 1 ? fragment.get('session') : null;
  history.replaceState(null, '', location.pathname + location.search);
  if (!/^[a-f0-9]{64}$/.test(token || '')) { error('The pasted session link is invalid. Reopen the complete original terminal URL.'); return; }
  if (token === capability && ready) return;
  if (pumping || connecting || uncertainJob) {
    error('The pasted session link was removed from the address bar. Wait for current work and cleanup to finish before reopening it, or open the terminal URL in a new tab.');
    return;
  }
  invalidate(); ready = false; capability = token;
  snapshot = null; files = []; filePage = 0; clearSource(); renderFiles();
  $('revision').textContent = 'Discover a revision first';
  $('catalog-summary').textContent = 'Discovery resolves the ref to one immutable commit.';
  void connectSession();
});
void connectSession();
