/**
 * View-only organization of the studio. The preview stays beside one tool at a time (song, lyrics, getting lyrics,
 * timing, practice or export); "Show all tools" lists every tool instead. Controls are never recreated or moved here,
 * only shown and hidden, so editor state is untouched.
 */
export const TOOLS = ['song', 'lyrics', 'get', 'timing', 'practice', 'export'] as const;
/** Whether every tool is listed is remembered in this browser, like other view conveniences. */
export const WORKSPACE_KEY = 'karaoke-workspace';
export type Tool = typeof TOOLS[number];

export interface Workspace {
  /** Shows a tool in the focused view. */
  show(tool: Tool): void;
  /** Shows the tool that holds this node, so it can be seen, scrolled to or focused. */
  reveal(node: Element | null): void;
  /** A clip has opened: from the song tool, move on to its lyrics. */
  clipOpened(): void;
  readonly active: Tool;
  readonly expanded: boolean;
}

/** The next tool for an arrow, Home or End key on the tab list, or null for any other key. */
export function nextTool(current: Tool, key: string): Tool | null {
  const index = TOOLS.indexOf(current), last = TOOLS.length - 1;
  const next = key === 'ArrowRight' ? (index === last ? 0 : index + 1) : key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
    : key === 'Home' ? 0 : key === 'End' ? last : -1;
  return next < 0 ? null : TOOLS[next];
}

export function mountWorkspace(root: Document = document): Workspace {
  const main = root.getElementById('workspace')!;
  const mode = root.getElementById('workspace-mode') as HTMLButtonElement;
  const tabs = new Map(TOOLS.map(tool => [tool, root.getElementById(`tab-${tool}`) as HTMLButtonElement]));
  const panels = new Map(TOOLS.map(tool => [tool, root.getElementById(`tool-${tool}`) as HTMLElement]));
  let active: Tool = 'song', expanded = false;
  try { expanded = localStorage.getItem(WORKSPACE_KEY) === 'all'; } catch { /* storage unavailable */ }

  function render(): void {
    main.classList.toggle('workspace-expanded', expanded);
    main.classList.toggle('workspace-focused', !expanded);
    mode.setAttribute('aria-pressed', String(expanded));
    for (const tool of TOOLS) {
      const selected = tool === active, tab = tabs.get(tool)!;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels.get(tool)!.hidden = !expanded && !selected;
    }
  }
  // The last control focused, so focus a tool lost (its button disabled while it worked) can be found again.
  let lastFocus: Element | null = null;
  root.addEventListener('focusin', event => { lastFocus = event.target as Element; });
  function show(tool: Tool, focusTab = false): void {
    if (tool === active && !focusTab) return;
    // Focus inside a tool that is about to be hidden, or lost from it to the page, moves to the new tool's tab.
    const panel = panels.get(active)!, focus = root.activeElement;
    const lost = (!focus || focus === root.body) && !!lastFocus && panel.contains(lastFocus);
    const leaving = !expanded && tool !== active && (lost || (!!focus && panel.contains(focus)));
    active = tool; render();
    if (focusTab || leaving) tabs.get(tool)!.focus({ preventScroll: true });
  }
  for (const [tool, tab] of tabs) {
    tab.addEventListener('click', () => show(tool));
    tab.addEventListener('keydown', event => {
      const next = nextTool(tool, event.key);
      if (!next) return;
      event.preventDefault(); show(next, true);
    });
  }
  mode.addEventListener('click', () => {
    expanded = !expanded; render();
    try { localStorage.setItem(WORKSPACE_KEY, expanded ? 'all' : 'focused'); } catch { /* storage unavailable */ }
  });
  render();
  return {
    show: tool => show(tool),
    reveal(node) {
      if (!node || expanded) return;
      const panel = node.closest('[role="tabpanel"]');
      const tool = TOOLS.find(candidate => panels.get(candidate) === panel);
      if (tool) show(tool);
    },
    clipOpened() { if (active === 'song') show('lyrics'); },
    get active() { return active; },
    get expanded() { return expanded; },
  };
}
