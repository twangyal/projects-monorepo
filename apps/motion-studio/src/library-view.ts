import type { LibraryHead } from './library-storage.ts';

/** Library receipts update this list only; editor fields belong to the workspace. */
export function createLibraryView(host: HTMLElement, open: (id: string) => void, remove: (id: string) => void) {
  host.innerHTML = `<div class="library-heading"><h3>Projects</h3><span id="project-library-count">0 / 8 saved projects</span></div><p id="project-library-status" aria-live="polite">Opening your projects…</p><ul id="project-library-list"></ul><div class="library-actions"><button id="refresh-project-library">Refresh projects</button><button id="duplicate-project">Duplicate current project</button><button id="save-project-as-new">Save memory as new project</button><button id="download-legacy-project">Download original legacy draft</button></div><p class="hint">Each project keeps its own artwork. Opening another starts a fresh Undo history. Download project files for backups outside this browser.</p>`;
  const list = host.querySelector<HTMLUListElement>('#project-library-list')!;
  const rows = new Map<string, HTMLLIElement>();
  function update(head: LibraryHead | null, active: string | null, locked: boolean) {
    const entries = head?.entries ?? [];
    host.querySelector('#project-library-count')!.textContent = `${entries.length} / 8 saved projects`;
    const ids = new Set(entries.map(entry => entry.id));
    for (const [id, row] of rows) if (!ids.has(id)) { row.remove(); rows.delete(id); }
    for (const [index, entry] of entries.entries()) {
      let row = rows.get(entry.id);
      if (!row) {
        row = document.createElement('li'); row.dataset.projectId = entry.id;
        const title = document.createElement('strong'); title.dataset.projectTitle = '';
        const current = document.createElement('span'); current.className = 'library-active';
        const actions = document.createElement('div'); actions.className = 'library-row-actions';
        for (const [action, label, callback] of [['open', 'Open', open], ['delete', 'Delete', remove]] as const) {
          const button = document.createElement('button'); button.dataset.libraryAction = action; button.textContent = label;
          button.addEventListener('click', () => callback(entry.id)); actions.append(button);
        }
        row.append(title, current, actions); rows.set(entry.id, row);
      }
      row.querySelector('[data-project-title]')!.textContent = entry.title;
      row.querySelector('.library-active')!.textContent = entry.id === active ? 'Current project' : '';
      row.setAttribute('aria-current', entry.id === active ? 'true' : 'false');
      for (const button of row.querySelectorAll<HTMLButtonElement>('button')) {
        button.disabled = locked;
        button.setAttribute('aria-label', `${button.dataset.libraryAction === 'open' ? 'Open' : 'Delete'} project: ${entry.title}`);
      }
      // Do not detach an unchanged focused row merely to refresh metadata.
      const position = list.children.item(index);
      if (position !== row) list.insertBefore(row, position);
    }
  }
  return { update, status(text: string) { host.querySelector('#project-library-status')!.textContent = text; } };
}
