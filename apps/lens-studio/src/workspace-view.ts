export type PhotoView = 'compare' | 'open' | 'depth' | 'mask' | 'project' | 'help';
interface WorkspaceOptions {
  main: HTMLElement;
  groups: Record<PhotoView, HTMLElement[]>;
  hasProject(): boolean;
  canNavigate(): boolean;
  perspectiveDetails: HTMLDetailsElement;
  framingInput: HTMLInputElement;
}
/** Presentation only: no editor intent, fields, history or worker ownership is changed. */
export function createPhotoWorkspace({main, groups, hasProject, canNavigate, perspectiveDetails, framingInput}: WorkspaceOptions) {
  const nav = document.createElement('nav'); nav.className = 'workspace-nav'; nav.setAttribute('aria-label', 'Photo workspace');
  const choices: [PhotoView,string][] = [['compare','Compare'],['open','Open'],['depth','Depth'],['mask','Mask exchange'],['project','Project & export'],['help','Help']];
  const buttons = new Map<PhotoView,HTMLButtonElement>();
  let current: PhotoView = 'open', expanded = false, returnTo: HTMLElement | null = null;
  function control(text: string, action: () => void) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.addEventListener('click', action); return button;
  }
  for (const [id,label] of choices) { const button = control(label, () => select(id)); buttons.set(id,button); nav.append(button); }
  const mode = control('Expand workspace', () => { if (!canNavigate()) return; expanded = !expanded; sync(); }); mode.id = 'workspace-mode';
  const back = control('Back to comparison', () => close()); back.id = 'workspace-back';
  const framing = control('Adjust framing', () => {if(!canNavigate()||!hasProject())return;select('compare');framingInput.focus({preventScroll:true});const target=groups.compare[0];window.scrollTo({top:Math.max(0,target.getBoundingClientRect().top+window.scrollY-nav.getBoundingClientRect().height-12),behavior:'instant'});});
  const recovery = control('Review save recovery', () => select('project')); recovery.id = 'workspace-recovery';
  const tools = document.createElement('div'); tools.className = 'workspace-tools'; tools.append(back,framing,mode,recovery);
  main.prepend(nav,tools);
  function sync() {
    main.dataset.view = current; main.classList.toggle('expanded-workspace', expanded);
    for (const [id,elements] of Object.entries(groups)) for (const element of elements) element.hidden = !expanded && id !== current;
    for (const [id,button] of buttons) { button.setAttribute('aria-pressed', String(!expanded && id === current)); button.disabled = !hasProject() && ['compare','depth','mask'].includes(id); }
    if(expanded)perspectiveDetails.open=true;
    mode.textContent = expanded ? 'Focus workspace' : 'Expand workspace'; mode.setAttribute('aria-pressed',String(expanded));
    framing.hidden=!hasProject();
    back.textContent=hasProject()?'Back to comparison':'Back to Open';
    back.hidden = expanded || current === (hasProject()?'compare':'open');
  }
  function select(view: PhotoView) {
    if (!canNavigate() || !hasProject() && ['compare','depth','mask'].includes(view)) return;
    if (current === (hasProject()?'compare':'open') && view !== current) returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    current = view; expanded = false; sync();
    if(view==='compare'){window.scrollTo({top:0,behavior:'instant'});return;}
    const target = groups[view][0];
    if (target) window.scrollTo({top:Math.max(0,target.getBoundingClientRect().top + window.scrollY - nav.getBoundingClientRect().height - 12),behavior:'instant'});
  }
  function close() {
    if (!canNavigate()) return;
    current = hasProject()?'compare':'open'; expanded = false; sync();
    const target = returnTo?.isConnected && returnTo.getClientRects().length ? returnTo : buttons.get(current)!;
    target.focus({preventScroll:true}); window.scrollTo({top:0,behavior:'instant'});
  }
  // Escape belongs first to a pending mask review or gesture in the editor.
  const escape = (event: KeyboardEvent) => { if(event.key==='Escape' && !event.defaultPrevented && (expanded || current!=='compare')) { event.preventDefault(); close(); } };
  window.addEventListener('keydown',escape);
  sync();
  return {sync, select, published(){if(current==='open')current='compare';sync();}, canPaint(){return expanded || current==='depth';}};
}
