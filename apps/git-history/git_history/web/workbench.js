'use strict';
import { createContextDraft, addContextRecord, updateContextRecord, removeContextRecord, rebindContextDraft, serializeContextDraft, evidenceCommits } from './context-editor.js';
import { validateChangedCatalog, changedPage, changedHandoff, changedJson, CHANGES_PAGE_SIZE } from './changed-files.js';
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
let contextMode = 'none', evidence = null, authored = null, authoredEpoch = 0, inputEpoch = 0;
let rowKeys = [], nextRowKey = 0, editingKey = null, rawDirty = false, downloadedEpoch = -1;
let contextReceipt = null, contextUrl = null;
const authoredRows = new Map();
let changes = null, changesCurrent = false, changesPage = 0, changesUrl = null, comparisonInputEpoch = 0;
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
  retireChanges();
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
  contextControls();
  comparisonControls();
  changesControls();
}
function revokeDownloads() {
  revokeComparisonDownloads();
  if (htmlUrl) URL.revokeObjectURL(htmlUrl);
  if (jsonUrl) URL.revokeObjectURL(jsonUrl);
  htmlUrl = null; jsonUrl = null;
  if (contextUrl) URL.revokeObjectURL(contextUrl);
  contextUrl = null; contextReceipt = null;
  $('download-context').removeAttribute('href'); $('download-context').setAttribute('aria-disabled', 'true');
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
$('stop-button').addEventListener('click', () => { retireChanges(); invalidate(); status(pumping ? 'Stopping work and waiting for cleanup…' : 'Stopped.'); });
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
  const attempt = ++contextGeneration; contextLoading = true; contextMode = 'uploaded'; inputEpoch++; invalidate(); const readIntent = generation; controls();
  try {
    if (file.size > 256 * 1024) throw new Error('Supplied context exceeds 256 KiB. Existing context was kept.');
    const bytes = await file.arrayBuffer(); const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (attempt !== contextGeneration || readIntent !== generation) return;
    context = text; contextName = file.name; error('');
  } catch (failure) { if (attempt === contextGeneration && readIntent === generation) error(failure instanceof TypeError ? 'Context must be valid UTF-8. Existing context was kept.' : failure.message); }
  finally {
    if (attempt === contextGeneration) { contextLoading = false; controls(); }
  }
});
$('context-clear').addEventListener('click', () => { contextGeneration++; contextLoading = false; context = null; contextName = ''; if (contextMode === 'uploaded') contextMode = 'none'; inputEpoch++; invalidate(); controls(); });
function integer(input, min, max, label) {
  if (!/^[0-9]+$/.test(input) || !Number.isSafeInteger(Number(input)) || Number(input) < min || Number(input) > max) throw new Error(`${label} must be an integer from ${min} to ${max}. Your input is kept.`);
  return Number(input);
}
const contextFields = ['commit', 'title', 'author', 'url', 'excerpt'];
function selectionIdentity() {
  if (!source) throw new Error('Open committed source before generating a report.');
  let selection;
  if ($('selection-mode').value === 'function') {
    if (!selectedFunction) throw new Error('Choose a function or use a manual range.');
    selection = { function: selectedFunction };
  } else {
    const start = integer($('start-line').value, 1, source.line_count, 'Start line');
    const end = integer($('end-line').value, start, source.line_count, 'End line');
    if (end - start + 1 > 200) throw new Error('Select at most 200 lines. Your range is kept.');
    selection = { start, end };
  }
  return { revision: source.revision, path: source.path, selection, max_commits: integer($('max-commits').value, 1, 50, 'Maximum commits') };
}
function evidenceMatchesSelection() {
  try { return evidence !== null && JSON.stringify(evidence.identity) === JSON.stringify(selectionIdentity()); }
  catch { return false; }
}
function contextControls() {
  $('context-status').textContent = contextLoading ? 'Reading supplied JSON; existing context is kept until this read succeeds…' : context === null ? 'No supplied context' : `${visible(contextName)} · supplied and unverified · checked against the report when generated`;
  $('context-mode').value = contextMode;
  $('authored-context').hidden = contextMode !== 'authored';
  $('generate-report').textContent = contextMode === 'authored' ? 'Generate report with context' : 'Generate report';
  $('author-context').disabled = !evidence;
  const matched = evidenceMatchesSelection();
  $('context-evidence-status').textContent = evidence ? `Picker from completed report: ${visible(evidence.identity.path)} · ${evidence.identity.revision} · ${evidence.commits.length} displayed commits. ${matched ? 'Selection matches this evidence.' : 'Selection changed; picker retains earlier evidence. Generate a fresh report in None mode to refresh it.'}` : 'Generate a history report to choose commits actually displayed in its evidence.';
  $('context-bound-revision').textContent = authored ? `Draft bound revision: ${authored.revision}` : 'No authored envelope. Generate evidence, then choose Author supplied discussion.';
  $('context-rebind').disabled = !authored || !evidence || authored.revision === evidence.identity.revision || !matched;
  $('context-draft-status').textContent = authored ? `${authored.records.length} / 50 local unverified records.${editingKey !== null ? ' Editing a retained record; save or cancel before submission.' : rawDirty ? ' Unapplied form values; add or cancel before submission.' : ''}${contextReceipt?.mode === 'authored' ? ' This exact draft was accepted with the completed report.' : ' Validate the complete draft with a report before downloading context.'}` : 'No authored records yet.';
  $('context-add-record').hidden = editingKey !== null;
  $('context-save-record').hidden = editingKey === null;
  $('context-add-record').disabled = !authored;
  $('context-save-record').disabled = !authored;
}
function updateCommitPicker() {
  // Evidence updates never replace the select node or silently change its raw choice.
  const select = $('discussion-commit'), selected = select.value;
  const options = [new Option('Choose a displayed commit', '')];
  for (const item of evidence?.commits || []) options.push(new Option(`${item.label} · ${item.commit}`, item.commit));
  if (selected && !options.some(option => option.value === selected)) { const retained = new Option(`Previously selected commit; absent from current picker · ${selected}`, selected); retained.disabled = true; options.push(retained); }
  select.replaceChildren(...options); select.value = selected;
}
function formRecord() { return Object.fromEntries(contextFields.map(field => [field, $('discussion-' + field).value])); }
function resetRecordForm() {
  editingKey = null; rawDirty = false;
  for (const field of contextFields) $('discussion-' + field).value = '';
  updateCommitPicker(); contextControls();
}
function localContextIntent() { inputEpoch++; invalidate(); }
function activateAuthoring() {
  if (!evidence) { error('Generate a history report first. Only commits actually displayed in its evidence can be picked.'); return; }
  if (!authored) { authored = createContextDraft(evidence.identity.revision); authoredEpoch++; }
  contextGeneration++; contextLoading = false; contextMode = 'authored'; localContextIntent();
  error(''); contextControls();
}
$('author-context').addEventListener('click', activateAuthoring);
$('context-mode').addEventListener('change', () => {
  contextGeneration++; contextLoading = false; contextMode = $('context-mode').value;
  localContextIntent(); contextControls();
});
for (const field of contextFields) {
  const input = $('discussion-' + field);
  input.addEventListener('input', () => { rawDirty = true; localContextIntent(); });
  if (field === 'commit') input.addEventListener('change', () => { rawDirty = true; localContextIntent(); });
}
function renderAuthoredRows() {
  const host = $('authored-context-list');
  for (const [key, row] of authoredRows) if (!rowKeys.includes(key)) { row.remove(); authoredRows.delete(key); }
  for (let index = 0; index < rowKeys.length; index++) {
    const key = rowKeys[index], record = authored.records[index];
    let row = authoredRows.get(key);
    if (!row) {
      row = node('li'); row.dataset.contextRow = key;
      for (const field of ['commit', 'title', 'author', 'url', 'excerpt']) {
        const text = node(field === 'excerpt' ? 'pre' : field === 'url' ? 'a' : 'p'); text.dataset.contextField = field; row.append(text);
      }
      const actions = node('div', undefined, 'context-row-actions'), edit = node('button', 'Edit'), remove = node('button', 'Remove');
      edit.type = remove.type = 'button'; edit.dataset.contextAction = 'edit'; remove.dataset.contextAction = 'remove';
      edit.addEventListener('click', () => {
        if (rawDirty || editingKey !== null) { error('Save or cancel the active record form before editing another record.'); return; }
        const current = rowKeys.indexOf(key); if (current < 0) return;
        editingKey = key; rawDirty = false; localContextIntent(); updateCommitPicker();
        const retained = authored.records[current], select = $('discussion-commit');
        if (![...select.options].some(option => option.value === retained.commit)) { const option = new Option(`Retained record commit; absent from current picker · ${retained.commit}`, retained.commit); option.disabled = true; select.add(option); }
        for (const field of contextFields) $('discussion-' + field).value = retained[field];
        error(''); contextControls(); $('discussion-title').focus();
      });
      remove.addEventListener('click', () => {
        if (rawDirty || editingKey !== null) { error('Save or cancel the active record form before removing a record.'); return; }
        const current = rowKeys.indexOf(key); if (current < 0) return;
        try {
          const candidate = removeContextRecord(authored, current);
          authored = candidate; rowKeys.splice(current, 1); authoredEpoch++; localContextIntent(); renderAuthoredRows(); error('');
          const following = authoredRows.get(rowKeys[Math.min(current, rowKeys.length - 1)]);
          (following?.querySelector('button') || $('context-add-record')).focus();
        } catch (failure) { error(failure.message); }
      });
      actions.append(edit, remove); row.append(actions); authoredRows.set(key, row);
    }
    row.dataset.contextIndex = String(index);
    for (const field of ['commit', 'title', 'author', 'url', 'excerpt']) row.querySelector(`[data-context-field="${field}"]`).textContent = record[field];
    const link = row.querySelector('[data-context-field="url"]'); link.href = record.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
    row.querySelector('[data-context-action="edit"]').setAttribute('aria-label', `Edit context record ${index + 1}`);
    row.querySelector('[data-context-action="remove"]').setAttribute('aria-label', `Remove context record ${index + 1}`);
    // Existing keyed rows are moved only when their order differs, never rebuilt on status updates.
    if (host.children[index] !== row) host.insertBefore(row, host.children[index] || null);
  }
  contextControls();
}
$('discussion-form').addEventListener('submit', event => {
  event.preventDefault(); if (!authored) { error('Choose Author supplied discussion after generating evidence.'); return; }
  try {
    const record = formRecord(), index = editingKey === null ? -1 : rowKeys.indexOf(editingKey);
    if (editingKey !== null && index < 0) throw new Error('The edited record is no longer available. Cancel the form and choose a retained record.');
    const candidate = editingKey === null ? addContextRecord(authored, record) : updateContextRecord(authored, index, record);
    if (editingKey === null) rowKeys.push('record-' + ++nextRowKey);
    authored = candidate; authoredEpoch++; localContextIntent(); resetRecordForm(); renderAuthoredRows(); error('');
  } catch (failure) { error(failure.message); }
});
$('context-cancel-edit').addEventListener('click', () => {
  localContextIntent(); resetRecordForm(); error('');
  status('Active record form cancelled. Retained records and uploaded context are unchanged.');
});
$('context-rebind').addEventListener('click', () => {
  if (!authored || !evidence || !evidenceMatchesSelection()) return;
  if (rawDirty || editingKey !== null) { error('Save or cancel the active record form before updating its bound revision.'); return; }
  const base = authored, target = evidence.identity.revision, token = generation, epoch = authoredEpoch;
  try {
    const candidate = rebindContextDraft(base, target);
    if (!window.confirm(`Update the authored context revision from ${base.revision} to ${target}? All retained records stay unchanged and require real report revalidation; a commit may be absent from the new evidence.`)) return;
    if (generation !== token || authored !== base || authoredEpoch !== epoch || rawDirty || editingKey !== null || !evidenceMatchesSelection()) { error('The selection or draft changed. Review the revision update again.'); return; }
    authored = candidate; authoredEpoch++; localContextIntent(); renderAuthoredRows(); error('');
  } catch (failure) { error(failure.message); }
});
$('download-context').addEventListener('click', event => {
  if ($('download-context').getAttribute('aria-disabled') === 'true' || !contextReceipt || contextReceipt.mode !== 'authored') { event.preventDefault(); return; }
  downloadedEpoch = contextReceipt.authoredEpoch;
});
window.addEventListener('beforeunload', event => {
  if (rawDirty || editingKey !== null || authored && authoredEpoch !== downloadedEpoch) { event.preventDefault(); event.returnValue = ''; }
});
$('report-form').addEventListener('submit', event => {
  event.preventDefault(); if (!source || contextLoading) return;
  try {
    const identity = selectionIdentity(), mode = contextMode;
    let contextText = mode === 'uploaded' ? context : null;
    if (mode === 'authored') {
      if (!authored) throw new Error('Generate evidence, then choose Author supplied discussion to bind a draft.');
      if (rawDirty || editingKey !== null) throw new Error('Add or save the active record form, or cancel it explicitly, before generating with authored context.');
      if (authored.revision !== identity.revision) throw new Error('The authored revision differs from this selection. Refresh evidence in None mode, then explicitly update the bound revision before validating.');
      contextText = serializeContextDraft(authored);
    }
    const args = { ...identity, context: contextText };
    const captured = { mode, contextText, identity, authoredEpoch, inputEpoch, uploadEpoch: contextGeneration };
    const description = `${visible(identity.path)} · ${identity.revision} · ${identity.selection.function ? 'function ' + visible(identity.selection.function) : 'lines ' + identity.selection.start + ':' + identity.selection.end} · up to ${identity.max_commits} commits · ${mode === 'authored' ? 'authored discussion, supplied and unverified' : contextText === null ? 'no supplied context' : 'unverified context: ' + visible(contextName)}`;
    queueJob('report', args, result => {
      if (captured.mode !== contextMode || captured.authoredEpoch !== authoredEpoch || captured.inputEpoch !== inputEpoch || captured.uploadEpoch !== contextGeneration) throw new Error('Context intent changed.');
      if (typeof result.html !== 'string' || typeof result.json !== 'string') throw new Error('Invalid history result.');
      const report = JSON.parse(result.json);
      if (report.revision !== identity.revision || report.path !== identity.path || (identity.selection.function ? report.selected_function !== identity.selection.function : report.start_line !== identity.selection.start || report.end_line !== identity.selection.end)) throw new Error('The result does not match the captured selection.');
      const commits = evidenceCommits(report);
      // Preview-only same-document links preserve the script-free opaque sandbox.
      // Download HTML/JSON remain the exact server-rendered bytes from this receipt.
      const preview = new DOMParser().parseFromString(result.html, 'text/html');
      for (const anchor of preview.querySelectorAll('a[href^="#"]')) anchor.setAttribute('href', 'about:srcdoc' + anchor.getAttribute('href'));
      const links = [];
      try {
        links.push(URL.createObjectURL(new Blob([result.html], { type: 'text/html;charset=utf-8' })));
        links.push(URL.createObjectURL(new Blob([result.json], { type: 'application/json;charset=utf-8' })));
        if (mode === 'authored') links.push(URL.createObjectURL(new Blob([contextText], { type: 'application/json;charset=utf-8' })));
      } catch (failure) { for (const link of links) URL.revokeObjectURL(link); throw failure; }
      revokeDownloads(); reportIdentity = description;
      evidence = { report, identity, commits };
      contextReceipt = { ...captured, html: result.html, json: result.json };
      $('report-frame').srcdoc = '<!doctype html>' + preview.documentElement.outerHTML;
      $('report-frame').hidden = false; $('report-empty').hidden = true;
      $('report-description').textContent = description; $('report-stale').hidden = true;
      [htmlUrl, jsonUrl] = links;
      for (const [id, href, filename] of [['download-html', htmlUrl, 'git-history-report.html'], ['download-json', jsonUrl, 'git-history-report.json']]) { $(id).href = href; $(id).download = filename; $(id).setAttribute('aria-disabled', 'false'); }
      if (mode === 'authored') { contextUrl = links[2]; $('download-context').href = contextUrl; $('download-context').download = 'git-supplied-discussion.json'; $('download-context').setAttribute('aria-disabled', 'false'); }
      updateCommitPicker(); contextControls();
    }, 'Collecting Git evidence.');
  } catch (failure) { error(failure.message); }
});
window.addEventListener('pagehide', () => {
  retireChanges();
  generation++; contextGeneration++; contextLoading = false; desired = null; ready = false; revokeDownloads();
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
  retireChanges(); invalidate(); ready = false; capability = token;
  snapshot = null; files = []; filePage = 0; clearSource(); renderFiles();
  for (const side of Object.values(comparisonSides)) unpinSide(side);
  $('revision').textContent = 'Discover a revision first';
  $('catalog-summary').textContent = 'Discovery resolves the ref to one immutable commit.';
  void connectSession();
});
// Comparison state is separate from history drafts, but all operations use the
// same queueJob/pump above. Only a matching global intent may publish a result.
const comparisonSides = Object.fromEntries(['left', 'right'].map(key => [key, {
  key, pin: null, source: null, files: [], functions: [], counts: new Map(),
  selectedFunction: null, filePage: 0, sourcePage: 0, functionPage: 0, missingVerified: false,
}]));
let comparison = null, comparisonPage = 0, comparisonHtmlUrl = null, comparisonJsonUrl = null;
const sideElement = (side, suffix) => $(side.key + '-' + suffix);
function revokeComparisonDownloads() {
  if (comparisonHtmlUrl) URL.revokeObjectURL(comparisonHtmlUrl);
  if (comparisonJsonUrl) URL.revokeObjectURL(comparisonJsonUrl);
  comparisonHtmlUrl = null; comparisonJsonUrl = null;
  for (const id of ['comparison-download-html', 'comparison-download-json']) {
    $(id).removeAttribute('href'); $(id).setAttribute('aria-disabled', 'true');
  }
  if (comparison) $('comparison-stale').hidden = false;
  for (const side of Object.values(comparisonSides)) side.missingVerified = false;
}
function currentSidePath(side) {
  try { return boundedText(exactText(sideElement(side, 'path').value, 'Path'), 4096, 'Path'); }
  catch { return null; }
}
function currentSideSource(side) {
  return side.pin && side.source && side.source.revision === side.pin.revision && side.source.path === currentSidePath(side) ? side.source : null;
}
function comparisonControls() {
  const unavailable = !ready || uncertainJob;
  let valid = !unavailable, missing = 0;
  for (const side of Object.values(comparisonSides)) {
    const mode = sideElement(side, 'selection-mode').value, loaded = currentSideSource(side);
    sideElement(side, 'discover-button').disabled = unavailable;
    sideElement(side, 'open-source').disabled = unavailable || !side.pin;
    sideElement(side, 'functions-button').disabled = unavailable || !loaded;
    sideElement(side, 'start-line').disabled = mode !== 'lines';
    sideElement(side, 'end-line').disabled = mode !== 'lines';
    sideElement(side, 'missing-status').hidden = mode !== 'missing';
    sideElement(side, 'missing-status').textContent = side.missingVerified ? 'Verified absent at pinned revision' : 'Verification pending';
    let help = 'Select at most 200 physical lines. Empty whole files are valid.';
    if (!side.pin) help = 'Discover this ref to pin an immutable revision first.';
    else if (mode === 'missing') { missing++; help = 'Choose the exact absent path. Absence is checked only when comparison succeeds.'; }
    else if (!loaded) help = 'Open this exact path at the pinned revision before selecting present source.';
    else if (mode === 'whole' && loaded.line_count > 200) help = `Whole file has ${loaded.line_count} lines. Choose a smaller manual range or function of at most 200 lines.`;
    else if (mode === 'function' && !side.selectedFunction) help = 'Discover functions and explicitly select a unique function, or use a manual range.';
    sideElement(side, 'selection-help').textContent = help;
    if (!side.pin || currentSidePath(side) === null || mode !== 'missing' && (!loaded || mode === 'whole' && loaded.line_count > 200 || mode === 'function' && !side.selectedFunction)) valid = false;
  }
  $('compare-button').disabled = !valid || missing === 2;
  if (missing === 2) $('left-selection-help').textContent = 'Both sides cannot be missing. Select present source on at least one side.';
}
function clearSideSource(side) {
  side.source = null; side.functions = []; side.counts = new Map(); side.selectedFunction = null;
  side.sourcePage = 0; side.functionPage = 0; side.missingVerified = false;
  sideElement(side, 'selected-path').textContent = 'No source loaded';
  sideElement(side, 'selected-function').textContent = 'No named function selected';
  sideElement(side, 'function-status').textContent = 'Whole files, manual ranges and missing paths do not require an optional parser.';
  renderSideSource(side); renderSideFunctions(side);
}
function unpinSide(side) {
  side.pin = null; side.files = []; side.filePage = 0; clearSideSource(side);
  sideElement(side, 'revision').textContent = 'Discover this ref to resolve its commit';
  sideElement(side, 'catalog-summary').textContent = 'Discovery controls changed. Discover again to pin this side.';
  renderSideFiles(side);
}
function sideDiscoveryChanged(side) { invalidate(); unpinSide(side); controls(); }
function sidePathChanged(side) { invalidate(); clearSideSource(side); controls(); }
function renderSideFiles(side) {
  const list = sideElement(side, 'file-list'); list.replaceChildren();
  const query = sideElement(side, 'file-filter').value.toLocaleLowerCase();
  const matches = side.files.filter(file => file.path.toLocaleLowerCase().includes(query));
  for (const file of matches.slice(side.filePage * PAGE, (side.filePage + 1) * PAGE)) {
    const item = node('li'), button = node('button'); button.type = 'button';
    button.append(node('span', visible(file.path), 'file-path'), node('small', `${file.language} · ${file.size_bytes} bytes`));
    button.addEventListener('click', () => { sideElement(side, 'path').value = JSON.stringify(file.path); sidePathChanged(side); openSideSource(side); });
    item.append(button); list.append(item);
  }
  pager(side.key + '-file', side.filePage, matches.length, PAGE, 'matches');
  sideElement(side, 'file-page').textContent += ` · ${side.files.length} total files`;
}
function physicalTokens(text) {
  if (text === '') return [];
  const parts = text.split('\n');
  const endsWithLf = parts.at(-1) === '';
  if (endsWithLf) parts.pop();
  return parts.map((part, index) => part + (index < parts.length - 1 || endsWithLf ? '\n' : ''));
}
function appendExactToken(cell, token) {
  let ending = 'No final newline', content = token;
  if (token.endsWith('\r\n')) { ending = 'CRLF'; content = token.slice(0, -2); }
  else if (token.endsWith('\n')) { ending = 'LF'; content = token.slice(0, -1); }
  cell.append(node('pre', content), node('span', ending, 'line-ending'));
}
function renderSideSource(side) {
  const body = sideElement(side, 'source-lines').tBodies[0]; body.replaceChildren();
  if (!side.source) { sideElement(side, 'source-caption').textContent = 'No source loaded'; pager(side.key + '-source', 0, 0, 100, 'lines'); return; }
  const tokens = side.source.tokens;
  sideElement(side, 'source-caption').textContent = `${visible(side.source.path)} · ${tokens.length} physical lines · committed source${tokens.length ? '' : ' · present empty file'}`;
  for (let index = side.sourcePage * 100; index < Math.min(tokens.length, (side.sourcePage + 1) * 100); index++) {
    const row = node('tr'), number = node('th'), button = node('button', String(index + 1)); number.scope = 'row'; button.type = 'button';
    button.setAttribute('aria-label', `Select ${side.key} line ${index + 1}`);
    button.addEventListener('click', event => {
      const start = Number(sideElement(side, 'start-line').value);
      if (event.shiftKey && Number.isInteger(start) && start > 0 && start <= index + 1) sideElement(side, 'end-line').value = String(index + 1);
      else { sideElement(side, 'start-line').value = String(index + 1); sideElement(side, 'end-line').value = String(index + 1); }
      sideElement(side, 'selection-mode').value = 'lines'; invalidate(); controls();
    });
    number.append(button); const cell = node('td'); appendExactToken(cell, tokens[index]); row.append(number, cell); body.append(row);
  }
  pager(side.key + '-source', side.sourcePage, tokens.length, 100, 'lines');
}
function renderSideFunctions(side) {
  const list = sideElement(side, 'function-list'); list.replaceChildren();
  const query = sideElement(side, 'function-filter').value.toLocaleLowerCase();
  const matches = side.functions.filter(fn => fn.qualified_name.toLocaleLowerCase().includes(query));
  for (const fn of matches.slice(side.functionPage * PAGE, (side.functionPage + 1) * PAGE)) {
    const item = node('li'), length = fn.end_line - fn.start_line + 1;
    const eligible = length <= 200 && side.counts.get(fn.qualified_name) === 1 && utf8.encode(fn.qualified_name).length <= 8192;
    item.append(node('p', visible(fn.qualified_name)), node('small', `${fn.kind} · lines ${fn.start_line}:${fn.end_line} · ${length} lines`));
    const button = node('button', eligible ? 'Select function' : 'Use manual range'); button.type = 'button';
    button.addEventListener('click', () => {
      invalidate(); sideElement(side, 'start-line').value = String(fn.start_line); sideElement(side, 'end-line').value = String(fn.end_line);
      if (eligible) { side.selectedFunction = fn.qualified_name; sideElement(side, 'selection-mode').value = 'function'; sideElement(side, 'selected-function').textContent = `Selected function: ${visible(fn.qualified_name)}`; }
      else { sideElement(side, 'selection-mode').value = 'lines'; status(length > 200 ? 'This function is longer than 200 lines. Narrow the manual range before comparing.' : 'This name is ambiguous or too long. Use an explicit manual range.'); }
      side.sourcePage = Math.floor((fn.start_line - 1) / 100); renderSideSource(side); controls();
    });
    item.append(button); list.append(item);
  }
  pager(side.key + '-function', side.functionPage, matches.length, PAGE, 'matches');
  sideElement(side, 'function-page').textContent += ` · ${side.functions.length} total functions`;
}
function openSideSource(side) {
  if (!side.pin) { error('Discover this side before opening its exact path.'); return; }
  try {
    const revision = side.pin.revision, path = boundedText(exactText(sideElement(side, 'path').value, 'Path'), 4096, 'Path');
    queueJob('source', { revision, path }, result => {
      if (side.pin?.revision !== revision || currentSidePath(side) !== path || result.revision !== revision || result.path !== path) throw new Error('Selection changed.');
      clearSideSource(side); side.source = { ...result, tokens: physicalTokens(result.source) };
      sideElement(side, 'selected-path').textContent = visible(result.path); renderSideSource(side); controls();
    }, `Reading ${side.key} committed source.`);
  } catch (failure) { error(failure.message); }
}
for (const side of Object.values(comparisonSides)) {
  for (const suffix of ['ref', 'directory']) sideElement(side, suffix).addEventListener('input', () => sideDiscoveryChanged(side));
  for (const event of ['input', 'change']) sideElement(side, 'language').addEventListener(event, () => sideDiscoveryChanged(side));
  sideElement(side, 'path').addEventListener('input', () => sidePathChanged(side));
  for (const suffix of ['start-line', 'end-line']) sideElement(side, suffix).addEventListener('input', invalidate);
  for (const event of ['input', 'change']) sideElement(side, 'selection-mode').addEventListener(event, () => { invalidate(); controls(); });
  sideElement(side, 'discovery-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const args = { ref: boundedText(sideElement(side, 'ref').value, 1024, 'Ref'), directory: boundedText(exactText(sideElement(side, 'directory').value, 'Directory'), 4096, 'Directory', true), language: sideElement(side, 'language').value };
      queueJob('files', args, catalog => {
        side.pin = { revision: catalog.revision, requested_ref: catalog.requested_ref }; clearSideSource(side);
        side.files = catalog.files; side.filePage = 0; sideElement(side, 'revision').textContent = catalog.revision;
        sideElement(side, 'catalog-summary').textContent = `Requested ref: ${visible(catalog.requested_ref)} · ${catalog.files.length} candidates · ${catalog.omitted_non_utf8_paths || 0} non-UTF-8 paths omitted. All reads on this side use the pinned commit above.`;
        renderSideFiles(side); controls();
      }, `Discovering ${side.key} ref.`);
    } catch (failure) { error(failure.message); }
  });
  sideElement(side, 'source-form').addEventListener('submit', event => { event.preventDefault(); openSideSource(side); });
  sideElement(side, 'functions-button').addEventListener('click', () => {
    const source = currentSideSource(side); if (!source) return;
    const { revision, path } = source;
    queueJob('functions', { revision, path }, catalog => {
      if (side.pin?.revision !== revision || currentSidePath(side) !== path || side.source !== source) throw new Error('Selection changed.');
      side.functions = catalog.functions; side.functionPage = 0; side.counts = new Map();
      for (const fn of side.functions) side.counts.set(fn.qualified_name, (side.counts.get(fn.qualified_name) || 0) + 1);
      sideElement(side, 'function-status').textContent = `${side.functions.length} committed definitions. Long or ambiguous functions need a smaller explicit manual range.`;
      renderSideFunctions(side); controls();
    }, `Discovering ${side.key} functions.`);
  });
  for (const [kind, change, render] of [['file', n => { side.filePage += n; }, renderSideFiles], ['source', n => { side.sourcePage += n; }, renderSideSource], ['function', n => { side.functionPage += n; }, renderSideFunctions]]) {
    sideElement(side, kind + '-prev').addEventListener('click', () => { change(-1); render(side); });
    sideElement(side, kind + '-next').addEventListener('click', () => { change(1); render(side); });
  }
  sideElement(side, 'file-filter').addEventListener('input', () => { side.filePage = 0; renderSideFiles(side); });
  sideElement(side, 'function-filter').addEventListener('input', () => { side.functionPage = 0; renderSideFunctions(side); });
}
function comparisonTarget(side) {
  if (!side.pin) throw new Error(`Discover the ${side.key} ref first.`);
  const path = boundedText(exactText(sideElement(side, 'path').value, 'Path'), 4096, 'Path');
  const kind = sideElement(side, 'selection-mode').value, source = currentSideSource(side);
  let selection = { kind };
  if (kind !== 'missing' && !source) throw new Error(`Open the ${side.key} source at its pinned revision first.`);
  if (kind === 'whole') { if (source.line_count > 200) throw new Error(`The ${side.key} whole file exceeds 200 lines. Choose a smaller range or function.`); }
  else if (kind === 'lines') {
    const start = integer(sideElement(side, 'start-line').value, 1, source.line_count, `${side.key} start line`);
    const end = integer(sideElement(side, 'end-line').value, start, source.line_count, `${side.key} end line`);
    if (end - start + 1 > 200) throw new Error(`Select at most 200 lines on the ${side.key}. Your range is kept.`);
    selection = { kind, start, end };
  } else if (kind === 'function') {
    if (!side.selectedFunction) throw new Error(`Explicitly select a unique ${side.key} function or use a manual range.`);
    selection = { kind, function: side.selectedFunction };
  } else if (kind !== 'missing') throw new Error('Choose a supported comparison selection.');
  return { revision: side.pin.revision, path, selection };
}
function freezeView(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeView(child); Object.freeze(value); }
  return value;
}
function completedComparison(result, targets) {
  if (typeof result.html !== 'string' || typeof result.json !== 'string') throw new Error('Invalid comparison result.');
  const report = JSON.parse(result.json);
  if (report.schema_version !== 1 || report.kind !== 'source-comparison' || typeof report.repo_name !== 'string' || !Array.isArray(report.blocks) || report.blocks.length > 400) throw new Error('Invalid comparison report.');
  const tokens = {};
  for (const key of ['left', 'right']) {
    const side = report[key], target = targets[key];
    if (!side || side.revision !== target.revision || side.requested_ref !== target.revision || side.path !== target.path || typeof side.source !== 'string' || utf8.encode(side.source).length > 512 * 1024 || !['present', 'missing'].includes(side.status) || side.selection?.kind !== target.selection.kind) throw new Error('Invalid comparison side.');
    for (const field of ['start', 'end', 'function']) if ((side.selection[field] ?? null) !== (target.selection[field] ?? null)) throw new Error('Invalid comparison selection.');
    tokens[key] = physicalTokens(side.source);
    if (tokens[key].length > 200 || (side.status === 'missing') !== (target.selection.kind === 'missing') || side.status === 'missing' && (tokens[key].length || side.source_sha256 !== null)) throw new Error('Invalid source bounds.');
    if (!tokens[key].length && (side.start_line !== null || side.end_line !== null) || side.status === 'present' && !/^[a-f0-9]{64}$/.test(side.source_sha256 || '') || target.selection.kind === 'function' && typeof side.selected_function !== 'string') throw new Error('Invalid comparison metadata.');
    if (tokens[key].length && (!Number.isSafeInteger(side.start_line) || side.start_line < 1 || side.end_line !== side.start_line + tokens[key].length - 1)) throw new Error('Invalid line bounds.');
  }
  let left = 0, right = 0, unchanged = 0, removed = 0, added = 0;
  const rows = [];
  for (const block of report.blocks) {
    if (!block || !['equal', 'change'].includes(block.kind) || !['left_start', 'left_end', 'right_start', 'right_end'].every(field => Number.isSafeInteger(block[field])) || block.left_start !== left || block.right_start !== right || block.left_end < left || block.right_end < right || block.left_end > tokens.left.length || block.right_end > tokens.right.length) throw new Error('Invalid alignment.');
    const a = block.left_end - left, b = block.right_end - right;
    if (a + b === 0 || block.kind === 'equal' && (a !== b || tokens.left.slice(left, block.left_end).some((token, i) => token !== tokens.right[right + i]))) throw new Error('Invalid alignment equality.');
    for (let index = 0; index < Math.max(a, b); index++) rows.push({ kind: block.kind, left: index < a ? left + index : null, right: index < b ? right + index : null });
    if (block.kind === 'equal') unchanged += a; else { removed += a; added += b; }
    left = block.left_end; right = block.right_end;
  }
  if (left !== tokens.left.length || right !== tokens.right.length || unchanged !== report.unchanged_lines || removed !== report.removed_lines || added !== report.added_lines || rows.length > 400) throw new Error('Incomplete alignment.');
  return freezeView({ report, tokens, rows });
}
function selectionLabel(side) {
  if (side.status === 'missing') return 'Verified missing path';
  const scope = side.selection.kind === 'function' ? `function ${visible(side.selected_function)}` : side.selection.kind === 'whole' ? 'whole file' : 'manual range';
  return `${scope} · ${side.start_line === null ? 'present empty file' : `original lines ${side.start_line}:${side.end_line}`}`;
}
function renderComparisonMetadata() {
  const host = $('comparison-metadata'); host.replaceChildren();
  for (const key of ['left', 'right']) {
    const side = comparison.report[key], panel = node('section'), list = node('dl', undefined, 'snapshot');
    panel.append(node('h3', key === 'left' ? 'Left completed selection' : 'Right completed selection'));
    for (const [label, text] of [['Revision / submitted ref', side.revision], ['Path', visible(side.path)], ['Selection', selectionLabel(side)], ['Selected text SHA-256', side.source_sha256 ?? 'Not applicable — absent path']]) list.append(node('dt', label), node('dd', text));
    panel.append(list); host.append(panel);
  }
}
function renderComparisonRows() {
  const body = $('comparison-lines').tBodies[0]; body.replaceChildren();
  if (!comparison) { pager('comparison', 0, 0, 100, 'rows'); return; }
  for (const entry of comparison.rows.slice(comparisonPage * 100, (comparisonPage + 1) * 100)) {
    const row = node('tr'); row.className = 'comparison-' + entry.kind;
    for (const key of ['left', 'right']) {
      const index = entry[key], number = node('td'), cell = node('td');
      if (index === null) { number.textContent = '—'; cell.append(node('span', 'No line on this side', 'missing-line')); }
      else {
        const line = comparison.report[key].start_line + index; number.textContent = String(line); row.dataset[key + 'Line'] = String(line);
        appendExactToken(cell, comparison.tokens[key][index]);
      }
      number.className = 'comparison-number'; cell.className = entry.kind === 'change' && index !== null ? key === 'left' ? 'comparison-removed' : 'comparison-added' : '';
      row.append(number, cell);
    }
    body.append(row);
  }
  pager('comparison', comparisonPage, comparison.rows.length, 100, 'rows');
}
$('comparison-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const targets = { left: comparisonTarget(comparisonSides.left), right: comparisonTarget(comparisonSides.right) };
    if (targets.left.selection.kind === 'missing' && targets.right.selection.kind === 'missing') throw new Error('Both sides cannot be missing.');
    const requestedLabels = { left: comparisonSides.left.pin.requested_ref, right: comparisonSides.right.pin.requested_ref };
    queueJob('comparison', targets, result => {
      const completed = completedComparison(result, targets);
      const newHtml = URL.createObjectURL(new Blob([result.html], { type: 'text/html;charset=utf-8' }));
      let newJson;
      try { newJson = URL.createObjectURL(new Blob([result.json], { type: 'application/json;charset=utf-8' })); }
      catch (failure) { URL.revokeObjectURL(newHtml); throw failure; }
      revokeComparisonDownloads(); comparison = completed; comparisonPage = 0; comparisonHtmlUrl = newHtml; comparisonJsonUrl = newJson;
      $('comparison-description').textContent = `Completed committed text comparison in ${visible(completed.report.repo_name)}. Discovery labels: Left ${visible(requestedLabels.left)}; Right ${visible(requestedLabels.right)}. The exported requested refs are the exact submitted commit IDs shown below; the two refs were pinned independently.`;
      $('comparison-summary').textContent = `${completed.report.unchanged_lines} unchanged lines · ${completed.report.removed_lines} removed lines · ${completed.report.added_lines} added lines${completed.rows.length ? '' : ' · no source lines (empty present source remains distinct from absence)'}.`;
      $('comparison-stale').hidden = true;
      for (const key of ['left', 'right']) comparisonSides[key].missingVerified = completed.report[key].status === 'missing';
      renderComparisonMetadata(); renderComparisonRows();
      for (const [id, href, name] of [['comparison-download-html', newHtml, 'git-source-comparison.html'], ['comparison-download-json', newJson, 'git-source-comparison.json']]) { $(id).href = href; $(id).download = name; $(id).setAttribute('aria-disabled', 'false'); }
      controls();
    }, 'Comparing selected committed source.');
  } catch (failure) { error(failure.message); }
});
$('comparison-prev').addEventListener('click', () => { comparisonPage--; renderComparisonRows(); });
$('comparison-next').addEventListener('click', () => { comparisonPage++; renderComparisonRows(); });
for (const id of ['comparison-download-html', 'comparison-download-json']) $(id).addEventListener('click', event => { if ($(id).getAttribute('aria-disabled') === 'true') event.preventDefault(); });
for (const event of ['input', 'change']) $('workspace-mode').addEventListener(event, () => {
  retireChanges();
  invalidate();
  const comparing = $('workspace-mode').value === 'comparison';
  $('history-workspace').hidden = comparing; $('comparison-workspace').hidden = !comparing;
  status(pumping ? 'Workspace changed. Stopping previous work and waiting for cleanup…' : 'Workspace changed. Drafts and pinned revisions are kept.');
});

// Catalog metadata has its own immutable receipt. Side editing may keep that
// receipt, but every pending job still uses the single global pump above.
function retireChanges() {
  changesCurrent = false;
  if (changesUrl) URL.revokeObjectURL(changesUrl);
  changesUrl = null;
  $('changes-download-json').removeAttribute('href');
  $('changes-download-json').setAttribute('aria-disabled', 'true');
  $('changes-stale').hidden = !changes;
  changesControls();
}
function changesControls() {
  const unavailable = !ready || uncertainJob;
  $('changes-discover').disabled = unavailable;
  for (const button of $('changes-table').querySelectorAll('[data-use-change]')) {
    button.disabled = unavailable || !changesCurrent || !changedHandoff(changes, Number(button.dataset.useChange));
  }
  $('changes-download-json').setAttribute('aria-disabled', String(unavailable || !changesCurrent || !changesUrl));
}
function renderChanges() {
  const body = $('changes-table').tBodies[0]; body.replaceChildren();
  const page = changes ? changedPage(changes, $('changes-filter').value, $('changes-status-filter').value, changesPage) : { rows: [], total: 0, page: 0 };
  changesPage = page.page;
  for (const { entry, index } of page.rows) {
    const row = node('tr'); row.dataset.changeIndex = String(index);
    row.append(node('th', visible(entry.path), 'changes-path'), node('td', entry.change)); row.firstChild.scope = 'row';
    for (const endpoint of [entry.left, entry.right]) {
      const cell = node('td');
      if (!endpoint) cell.textContent = 'Absent';
      else cell.append(node('span', `${endpoint.kind} · ${endpoint.mode}`), node('code', endpoint.object_id));
      row.append(cell);
    }
    const action = node('td'), choice = node('button', 'Use these comparison paths'); choice.type = 'button'; choice.dataset.useChange = String(index);
    choice.addEventListener('click', () => useChangedPath(index)); action.append(choice);
    const eligible = changedHandoff(changes, index);
    action.append(node('p', eligible ? 'Regular blob candidate; text support is checked only when you open source.' : entry.addressable ? 'Symlink or gitlink metadata only. Its target is not opened.' : 'This literal path cannot be addressed by the source comparison API.', 'hint'));
    row.append(action); body.append(row);
  }
  pager('changes', page.page, page.total, CHANGES_PAGE_SIZE, 'matches');
  $('changes-page').textContent += ` · ${changes?.entries.length ?? 0} total changed paths`;
  changesControls();
}
function comparisonHasSelections() {
  return comparisonInputEpoch > 0 || comparison !== null || Object.values(comparisonSides).some(side => side.pin || side.source || side.selectedFunction || sideElement(side, 'ref').value !== 'HEAD' || sideElement(side, 'path').value !== '' || sideElement(side, 'start-line').value !== '1' || sideElement(side, 'end-line').value !== '1' || sideElement(side, 'selection-mode').value !== 'whole');
}
function useChangedPath(index) {
  if (!ready || uncertainJob || !changesCurrent) return;
  const captured = changes, handoff = changedHandoff(captured, index), owner = generation, input = comparisonInputEpoch;
  if (!handoff) return;
  if (comparisonHasSelections() && !window.confirm(`Replace the current comparison paths and selections with ${JSON.stringify(handoff.path)}?\nLeft: ${handoff.left.revision}\nRight: ${handoff.right.revision}\nSource will not be opened until you explicitly choose Open source.`)) return;
  if (!ready || uncertainJob || !changesCurrent || changes !== captured || generation !== owner || comparisonInputEpoch !== input || $('workspace-mode').value !== 'comparison') return;
  invalidate();
  for (const key of ['left', 'right']) {
    const side = comparisonSides[key], target = handoff[key]; unpinSide(side);
    side.pin = { revision: target.revision, requested_ref: target.requested_ref };
    sideElement(side, 'ref').value = target.revision;
    sideElement(side, 'directory').value = ''; sideElement(side, 'language').value = 'all';
    sideElement(side, 'path').value = JSON.stringify(handoff.path);
    sideElement(side, 'selection-mode').value = target.selection;
    sideElement(side, 'start-line').value = '1'; sideElement(side, 'end-line').value = '1';
    sideElement(side, 'revision').textContent = target.revision;
    sideElement(side, 'catalog-summary').textContent = `Changed-file catalog pin · requested ref ${visible(target.requested_ref)}. No source has been opened.`;
  }
  comparisonInputEpoch++;
  status(pumping ? 'Comparison paths prepared. Previous work is stopping; open each present source explicitly after cleanup.' : 'Comparison paths prepared. Open each present source explicitly; missing paths are verified by comparison.');
  controls();
}
for (const side of Object.values(comparisonSides)) {
  for (const suffix of ['ref', 'directory', 'language', 'path', 'start-line', 'end-line', 'selection-mode']) {
    for (const event of ['input', 'change']) sideElement(side, suffix).addEventListener(event, () => { comparisonInputEpoch++; });
  }
}
for (const id of ['changes-left-ref', 'changes-right-ref', 'changes-directory']) {
  for (const event of ['input', 'change']) $(id).addEventListener(event, () => { retireChanges(); invalidate(); });
}
$('changes-form').addEventListener('submit', event => {
  event.preventDefault();
  retireChanges(); invalidate();
  try {
    const args = { left_ref: boundedText($('changes-left-ref').value, 1024, 'Left ref'), right_ref: boundedText($('changes-right-ref').value, 1024, 'Right ref'), directory: boundedText(exactText($('changes-directory').value, 'Directory'), 4096, 'Directory', true) };
    queueJob('changed-files', args, result => {
      const completed = validateChangedCatalog(result), text = changedJson(completed);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
      retireChanges(); changes = completed; changesCurrent = true; changesPage = 0; changesUrl = url;
      $('changes-summary').textContent = `${completed.entries.length} changed paths · ${completed.omitted_non_utf8_paths} non-UTF-8 paths omitted. Left requested ${visible(completed.left_requested_ref)} → ${completed.left_revision}. Right requested ${visible(completed.right_requested_ref)} → ${completed.right_revision}. Directory: ${completed.directory ? visible(completed.directory) : '(entire tree)'}.`;
      $('changes-stale').hidden = true;
      $('changes-download-json').href = url; $('changes-download-json').download = 'git-changed-files.json';
      renderChanges();
    }, 'Discovering changed committed paths.');
  } catch (failure) { error(failure.message); }
});
for (const id of ['changes-filter', 'changes-status-filter']) $(id).addEventListener(id === 'changes-filter' ? 'input' : 'change', () => { changesPage = 0; renderChanges(); });
$('changes-prev').addEventListener('click', () => { changesPage--; renderChanges(); });
$('changes-next').addEventListener('click', () => { changesPage++; renderChanges(); });
$('changes-download-json').addEventListener('click', event => { if ($('changes-download-json').getAttribute('aria-disabled') === 'true') event.preventDefault(); });
renderChanges();
void connectSession();
