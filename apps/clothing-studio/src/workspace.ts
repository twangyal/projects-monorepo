/** View-only organization: move mounted controls, never recreate editor state. */
export function mountWorkspace(): void {
  const main = document.querySelector<HTMLElement>('#workspace')!;
  const product = document.querySelector<HTMLElement>('#product-editor')!;
  const grid = product.querySelector<HTMLElement>('.product-grid')!;
  const stage = product.querySelector<HTMLElement>('.product-stage')!;
  const inspector = product.querySelector<HTMLElement>('.product-inspector')!;
  const children = [...inspector.children] as HTMLElement[];
  const measurements = children.findIndex(n => n.textContent === 'MEASUREMENTS');
  const artwork = children.findIndex(n => n.textContent === 'ARTWORK');
  const notice = document.querySelector<HTMLElement>('#message')!;
  const noticeAnchor = document.createComment('workspace feedback'); notice.before(noticeAnchor);
  const nav = document.createElement('nav'); nav.className = 'garment-tools'; nav.setAttribute('aria-label', 'Garment tools'); nav.dataset.workspaceNavigation = 'true';
  const mode = document.createElement('button'); mode.id = 'workspace-mode'; mode.className = 'quiet'; mode.textContent = 'Show all tools';
  mode.setAttribute('aria-pressed', 'false');
  product.before(nav); nav.after(mode);
  main.classList.add('workspace-focused');
  // The product is the entry experience; concept and skirt editors remain intact in secondary dialogs.
  nav.before(product); product.before(nav, mode);
  const heading = main.querySelector('.workspace-heading h2'); if (heading) heading.textContent = 'Your garment workspace';
  const intro = main.querySelector('.workspace-heading > div > p:last-child'); if (intro) intro.textContent = 'Choose a tool, shape your design, return to the garment.';
  const panels = new Map<string, HTMLElement>(); const buttons = new Map<string, HTMLButtonElement>();
  let active: string | null = null, expanded = false, opener: HTMLElement | null = null;
  function hideAll(): void {
    noticeAnchor.after(notice);
    for (const panel of panels.values()) { if (panel instanceof HTMLDialogElement && panel.open) panel.close(); panel.hidden = true; }
    for (const button of buttons.values()) button.setAttribute('aria-expanded', 'false');
    active = null; main.classList.remove('workspace-has-panel');
  }
  function close(): void { hideAll(); opener?.focus(); }
  function focused(): void { expanded = false; main.classList.remove('workspace-expanded'); mode.textContent = 'Show all tools'; mode.setAttribute('aria-pressed', 'false'); hideAll(); }
  function panel(id: string, title: string, nodes: HTMLElement[], modal = false): void {
    const section = document.createElement(modal ? 'dialog' : 'section'); section.id = `workspace-${id}`; section.className = 'workspace-tool'; section.hidden = true;
    const head = document.createElement('div'); head.className = 'workspace-panel-heading'; head.dataset.workspaceNavigation = 'true';
    const label = document.createElement('h4'); label.id = `${section.id}-heading`; label.textContent = title; label.tabIndex = -1;
    section.setAttribute('aria-labelledby', label.id);
    const back = document.createElement('button'); back.className = 'quiet'; back.textContent = 'Back to garment';
    back.addEventListener('click', () => { if (expanded) focused(); close(); }); head.append(label, back); section.append(head, ...nodes);
    (modal ? product : grid).append(section); panels.set(id, section);
    const button = document.createElement('button'); button.textContent = title; button.setAttribute('aria-controls', section.id); button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => {
      const was = active === id; if (expanded) focused(); else hideAll(); opener = button;
      if (was) { button.focus(); return; }
      active = id; button.setAttribute('aria-expanded', 'true'); section.hidden = false; head.after(notice);
      if (section instanceof HTMLDialogElement) section.showModal(); else main.classList.add('workspace-has-panel');
      label.focus();
    }); nav.append(button); buttons.set(id, button);
    if (section instanceof HTMLDialogElement) section.addEventListener('cancel', event => { event.preventDefault(); close(); });
  }
  const take = (selector: string) => document.querySelector<HTMLElement>(selector)!;
  panel('designs', 'Saved designs', [take('#design-library')], true);
  panel('templates', 'Templates', [take('.product-templates'), take('.product-name')]);
  panel('materials', 'Materials & prints', [take('.product-library'), ...children.slice(0, measurements)]);
  panel('patterns', 'Patterns & measurements', [...children.slice(measurements, artwork), take('.pattern-strip')]);
  panel('artwork', 'Artwork', children.slice(artwork));
  inspector.remove();
  const body = take('#garment-drape-controls'), status = take('#garment-drape-status'); stage.append(status);
  panel('body', 'Body & drape', [body]);
  panel('exports', 'Exports', [take('#product-editor > .product-exports')]);
  panel('techpack', 'Tech pack', [take('.techpack')], true);
  panel('range', 'Range plan', [take('.range')], true);
  panel('concept', 'Concept sketch', [take('.workspace-grid')], true);
  panel('skirt', 'Skirt construction', [take('.construction-panel')], true);
  // Long explanations are contextual; primary status/draft feedback stays beside the garment.
  for (const node of [...product.children]) if (node.matches('p.fine-print')) panels.get('exports')!.append(node);
  const description = product.querySelector<HTMLElement>('.product-head > div > p:not(.eyebrow)'); if (description) panels.get('templates')!.append(description);
  nav.append(mode);
  mode.addEventListener('click', () => {
    if (expanded) { focused(); mode.focus(); return; }
    hideAll(); expanded = true; main.classList.add('workspace-expanded'); mode.textContent = 'Focus on garment'; mode.setAttribute('aria-pressed', 'true');
    for (const section of panels.values()) { section.hidden = false; if (section instanceof HTMLDialogElement) section.show(); }
    mode.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && active) { event.preventDefault(); event.stopPropagation(); close(); } }, true);
}
