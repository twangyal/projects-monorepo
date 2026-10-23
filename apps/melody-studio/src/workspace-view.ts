/** Presentation only: keep editors, file inputs and their owners mounted. */
const views = {
 compose: ['Compose', 'Choose a track, add or draw notes, then listen. Open a tool when you need it.'],
 capture: ['Capture', 'Record a melody, import audio or try the demo. Active operations keep their Cancel control visible.'],
 sound: ['Sound', 'Choose the selected track’s instrument, mix and effects. Enter applies a basic text field; effect panels have Apply and Discard.'],
 notes: ['Notes', 'Select a note in the piano roll, then apply its pitch, timing or articulation.'],
 arrange: ['Arrange', 'Work with tracks, song sections, timing, dynamics and suggested continuations.'],
 reference: ['Reference', 'Listen to the selected track’s original take and compare it with your notes.'],
 project: ['Project & export', 'Open or save complete projects, manage your library, import MIDI and export audio or notes.'],
} as const;
export type WorkspaceView = keyof typeof views;
const groups: Partial<Record<WorkspaceView, string>> = {
 capture: '.capture-card', sound: '.track-settings', notes: '#note-form, fieldset.note-editor, #chord-roll-panel',
 arrange: '.arrangement-tools, #continuation-panel, #track-timing, [aria-labelledby="section-heading"], [aria-labelledby="quantize-heading"], [aria-labelledby="phrase-pitch-heading"], [aria-labelledby="dynamics-heading"]',
 reference: '#reference-panel', project: '#composition-library, #midi-import, [aria-labelledby="save-heading"], footer',
};
export const workspaceControl = '[data-workspace-view], #workspace-mode, #workspace-back, #workspace-recovery, #workspace-stop';
export const workspacePresentation = `${workspaceControl}, #workspace-guidance summary, #roll-guidance summary, #chord-roll-panel summary, #move-track-earlier, #move-track-later`;
export function createWorkspaceView(root: HTMLElement, options: { canNavigate: () => boolean; captureActive: () => boolean; saveState: () => { message: string; recovery: boolean; visible: boolean }; stopAudio: () => void }) {
 let view: WorkspaceView = 'compose', expanded = false, navigating = false;
 const markup = () => `<section class="workspace-tools" aria-label="Workspace tools"><div class="workspace-navigation" role="group" aria-label="Choose workspace tools">${Object.entries(views).map(([key, [label]]) => `<button type="button" data-workspace-view="${key}" aria-pressed="false">${label}</button>`).join('')}</div><div class="workspace-utilities"><button type="button" id="workspace-back">Back to compose</button><button type="button" id="workspace-mode" aria-pressed="false">Expand workspace</button><button type="button" id="workspace-stop">Stop audio</button></div><details id="workspace-guidance"><summary>About these tools</summary><p id="workspace-help" class="small"></p></details><p id="workspace-feedback" role="status" class="small"></p><p id="workspace-save-feedback" role="status" class="small"></p><button type="button" id="workspace-recovery" hidden>Review save recovery</button></section>`;
 const template = document.createElement('template'); template.innerHTML = markup();
 const toolbar = template.content.firstElementChild as HTMLElement;
 root.querySelector('.site-header')!.after(toolbar);
 const measure = () => root.style.setProperty('--workspace-toolbar-height', `${Math.ceil(toolbar.getBoundingClientRect().height) + 12}px`);
 new ResizeObserver(measure).observe(toolbar);
 function focus() { root.querySelector<HTMLElement>(expanded ? '#workspace-mode' : `[data-workspace-view="${view}"]`)?.focus({ preventScroll: true }); }
 function sync() {
  root.dataset.workspaceSection = view; root.dataset.workspaceExpanded = String(expanded);
  for (const [key, selectors] of Object.entries(groups)) for (const element of root.querySelectorAll<HTMLElement>(selectors)) {
   element.hidden = !(expanded || view === key || key === 'capture' && options.captureActive());
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-workspace-view]')) button.setAttribute('aria-pressed', String(!expanded && button.dataset.workspaceView === view));
  const mode = root.querySelector<HTMLButtonElement>('#workspace-mode');
  if (mode) { mode.setAttribute('aria-pressed', String(expanded)); mode.textContent = expanded ? 'Focus workspace' : 'Expand workspace'; }
  const back = root.querySelector<HTMLButtonElement>('#workspace-back'); if (back) back.hidden = !expanded && view === 'compose';
  const help = root.querySelector('#workspace-help'); if (help) help.textContent = expanded ? 'All tools are visible. Focus workspace returns to your selected section.' : `${views[view][1]} Switching tools keeps unapplied drafts. Escape returns to composing.`;
  const guidance = root.querySelector<HTMLDetailsElement>('#roll-guidance'); if (guidance && expanded) guidance.open = true;
  const save = options.saveState(), saveFeedback = root.querySelector<HTMLElement>('#workspace-save-feedback');
  if (saveFeedback) { saveFeedback.hidden = expanded || !save.visible; if (saveFeedback.textContent !== save.message) saveFeedback.textContent = save.message; }
  const recovery = root.querySelector<HTMLButtonElement>('#workspace-recovery'); if (recovery) recovery.hidden = expanded || !save.recovery;
  const notice = root.querySelector<HTMLElement>('#notice'), feedback = root.querySelector<HTMLElement>('#workspace-feedback');
  if (notice && feedback) { notice.hidden = !expanded; feedback.hidden = expanded; if (feedback.textContent !== notice.textContent) feedback.textContent = notice.textContent; }
  measure();
 }
 function select(next: WorkspaceView, moveFocus = true) {
  if (!options.canNavigate()) return;
  navigating = true;
  try {
   view = next; expanded = false; sync();
   if (moveFocus) {
    focus();
    // Keep the creative workspace in place; contextual tools can be below it.
    const target = groups[view] ? root.querySelector<HTMLElement>(groups[view]!) : root.querySelector<HTMLElement>('.project-bar');
    if (target) window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - toolbar.getBoundingClientRect().height - 12), behavior: 'instant' });
   }
  } finally { navigating = false; }
 }
 root.addEventListener('pointerdown', event => {
  if ((event.target as HTMLElement).closest(workspacePresentation)) event.preventDefault();
 }, true);
 root.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(workspaceControl);
  if (!button || !root.contains(button)) return;
  event.preventDefault(); event.stopPropagation();
  if (button.id === 'workspace-stop') { options.stopAudio(); return; }
  if (!options.canNavigate()) return;
  if (button.id === 'workspace-mode') {
   navigating = true;
   try { expanded = !expanded; sync(); button.focus({ preventScroll: true }); } finally { navigating = false; }
  } else select(button.id === 'workspace-back' ? 'compose' : button.id === 'workspace-recovery' ? 'reference' : button.dataset.workspaceView as WorkspaceView);
 }, true);
 window.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented || !options.canNavigate() || !expanded && view === 'compose') return;
  event.preventDefault(); select('compose');
 });
 return { sync, select, focus, get view() { return view; }, get expanded() { return expanded; }, get navigating() { return navigating; } };
}
